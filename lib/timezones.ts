import { symbolInfo } from "./symbolId";

/** The special choices; any other value is an IANA zone from {@link TIMEZONES}. */
export const EXCHANGE_ZONE = "exchange";
export const LOCAL_ZONE = "local";

export const TIMEZONES: { id: string; label: string }[] = [
  { id: "UTC", label: "UTC" },
  { id: "Pacific/Honolulu", label: "Honolulu" },
  { id: "America/Anchorage", label: "Anchorage" },
  { id: "America/Los_Angeles", label: "Los Angeles" },
  { id: "America/Denver", label: "Denver" },
  { id: "America/Chicago", label: "Chicago" },
  { id: "America/New_York", label: "New York" },
  { id: "America/Toronto", label: "Toronto" },
  { id: "America/Sao_Paulo", label: "São Paulo" },
  { id: "Atlantic/Reykjavik", label: "Reykjavik" },
  { id: "Europe/London", label: "London" },
  { id: "Europe/Lisbon", label: "Lisbon" },
  { id: "Europe/Berlin", label: "Berlin" },
  { id: "Europe/Zurich", label: "Zurich" },
  { id: "Europe/Paris", label: "Paris" },
  { id: "Europe/Madrid", label: "Madrid" },
  { id: "Europe/Rome", label: "Rome" },
  { id: "Europe/Stockholm", label: "Stockholm" },
  { id: "Europe/Athens", label: "Athens" },
  { id: "Europe/Istanbul", label: "Istanbul" },
  { id: "Europe/Moscow", label: "Moscow" },
  { id: "Asia/Dubai", label: "Dubai" },
  { id: "Asia/Karachi", label: "Karachi" },
  { id: "Asia/Kolkata", label: "Mumbai" },
  { id: "Asia/Bangkok", label: "Bangkok" },
  { id: "Asia/Shanghai", label: "Shanghai" },
  { id: "Asia/Hong_Kong", label: "Hong Kong" },
  { id: "Asia/Singapore", label: "Singapore" },
  { id: "Asia/Seoul", label: "Seoul" },
  { id: "Asia/Tokyo", label: "Tokyo" },
  { id: "Australia/Sydney", label: "Sydney" },
  { id: "Pacific/Auckland", label: "Auckland" },
];

const zoneValidity = new Map<string, boolean>();
const MAX_CACHED_ZONES = 64;

export function isValidZone(zone: unknown): zone is string {
  if (typeof zone !== "string" || !zone) return false;
  if (zone === EXCHANGE_ZONE || zone === LOCAL_ZONE) return true;
  const cached = zoneValidity.get(zone);
  if (cached !== undefined) return cached;
  let valid: boolean;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    valid = true;
  } catch {
    valid = false;
  }
  if (zoneValidity.size >= MAX_CACHED_ZONES) zoneValidity.clear();
  zoneValidity.set(zone, valid);
  return valid;
}

/** The IANA zone a choice means for a given symbol. */
export function resolveZone(choice: string, symbol?: string): string {
  if (choice === LOCAL_ZONE) return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  if (choice === EXCHANGE_ZONE) {
    const zone = symbol ? symbolInfo(symbol)?.timezone : undefined;
    return zone && isValidZone(zone) ? zone : "UTC";
  }
  return isValidZone(choice) ? choice : "UTC";
}

/** Wall clock time in a zone, `HH:MM:SS`. */
export function formatClock(zone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(now);
}

/** Offset label such as `UTC`, `UTC+2` or `UTC-5:30`, honouring daylight saving on `now`. */
export function offsetLabel(zone: string, now: Date = new Date()): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" })
    .formatToParts(now)
    .find((p) => p.type === "timeZoneName")?.value;
  if (!part || part === "GMT" || part === "UTC") return "UTC";
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(part);
  if (!match) return part.replace("GMT", "UTC");
  if (Number(match[2]) === 0 && match[3] === "00") return "UTC";
  const hours = String(Number(match[2]));
  return `UTC${match[1]}${hours}${match[3] === "00" ? "" : `:${match[3]}`}`;
}

const wallFormatters=new Map<string,Intl.DateTimeFormat>();
function wallParts(time:number,zone:string):Record<string,string>{
  let formatter=wallFormatters.get(zone);
  if(!formatter){formatter=new Intl.DateTimeFormat("en-GB",{timeZone:zone,calendar:"iso8601",numberingSystem:"latn",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"});if(wallFormatters.size>=64)wallFormatters.clear();wallFormatters.set(zone,formatter);}
  return Object.fromEntries(formatter.formatToParts(new Date(time)).map(part=>[part.type,part.value]));
}
/** A chart-zone wall clock suitable for a date/time field, independent of the OS zone. */
export function wallDateTime(time:number,zone:string,precision:"minute"|"second"="minute"):string {
  const p=wallParts(time,zone);return `${p.year.padStart(4,"0")}-${p.month}-${p.day}T${p.hour}:${p.minute}${precision==="second"?`:${p.second}`:""}`;
}
/** All UTC instants represented by a local minute or second: zero in a DST gap, two in a fold. */
export function wallTimeCandidates(value:string,zone:string):number[]{
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value))return[];
  const precision=value.length===19?"second":"minute";
  const nominal=Date.parse(`${value}${precision==="minute"?":00":""}Z`);
  if(!Number.isFinite(nominal)||new Date(nominal).toISOString().slice(0,value.length)!==value)return[];
  const offsets=new Set<number>();
  for(let hours=-48;hours<=48;hours+=6){
    const sample=nominal+hours*3600000,p=wallParts(sample,zone),date=new Date(0);
    date.setUTCFullYear(Number(p.year),Number(p.month)-1,Number(p.day));date.setUTCHours(Number(p.hour),Number(p.minute),Number(p.second),0);
    offsets.add(date.getTime()-Math.floor(sample/1000)*1000);
  }
  return [...new Set([...offsets].map(offset=>nominal-offset).filter(time=>wallDateTime(time,zone,precision)===value))].sort((a,b)=>a-b);
}
