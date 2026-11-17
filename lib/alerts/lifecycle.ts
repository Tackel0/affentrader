import type {AlertLifecycleFields} from "@/types/alerts";

type Lifetime=AlertLifecycleFields&{createdAt?:number;expiresAt?:number;lastTriggeredAt?:number};
const validTime=(time:unknown):time is number=>typeof time==="number"&&Number.isSafeInteger(time)&&time>=0&&time<=8_640_000_000_000_000;
/** UTC calendar anniversary; clamp leap day to February's final day. */
export function yearAfter(time:number):number {
  const date=new Date(time),year=date.getUTCFullYear()+1,month=date.getUTCMonth();
  const lastDay=new Date(0);lastDay.setUTCFullYear(year,month+1,0);
  date.setUTCFullYear(year,month,Math.min(date.getUTCDate(),lastDay.getUTCDate()));
  return date.getTime();
}
export function trackedActivity(alert:AlertLifecycleFields,now=Date.now()):NonNullable<AlertLifecycleFields["activity"]>{return alert.activity??{trackedAt:now};}
export function editedActivity(alert:AlertLifecycleFields,now=Date.now()):NonNullable<AlertLifecycleFields["activity"]>{return {...trackedActivity(alert,now),editedAt:now};}
export function triggeredActivity(alert:AlertLifecycleFields,now=Date.now()):NonNullable<AlertLifecycleFields["activity"]>{return {...trackedActivity(alert,now),triggeredAt:now};}
/** Legacy snapshots have unknown edit history and receive a full tracking grace year. */
export function expirationReason(alert:Lifetime,now=Date.now()):"date"|"inactivity"|undefined {
  if(alert.expiresAt!==undefined&&alert.expiresAt<=now)return "date";
  if(!validTime(alert.createdAt)||!alert.activity||!validTime(alert.activity.trackedAt))return;
  const recent=Math.max(alert.createdAt,alert.activity.trackedAt,...[alert.activity.editedAt,alert.activity.triggeredAt,alert.lastTriggeredAt].filter(validTime));
  if(now>yearAfter(recent))return "inactivity";
}
export function lifecycleError(alert:AlertLifecycleFields):string|null {
  if(alert.activity!==undefined){
    const value=alert.activity;
    if(!value||typeof value!=="object"||Array.isArray(value)||!validTime(value.trackedAt)||value.editedAt!==undefined&&!validTime(value.editedAt)||value.triggeredAt!==undefined&&!validTime(value.triggeredAt))return "Invalid alert activity history.";
  }
  if(alert.expiration!==undefined){
    const value=alert.expiration;
    if(!value||typeof value!=="object"||Array.isArray(value)||!["date","inactivity"].includes(value.reason)||!validTime(value.time))return "Invalid alert expiration history.";
  }
  return null;
}
export function expirationLabel(alert:AlertLifecycleFields&{status:string}):string|undefined {
  if(alert.status!=="expired")return;
  return alert.expiration?.reason==="inactivity"?"Stopped — inactive for over a year. Edit and save this alert to renew it.":"Stopped — expiration reached. Edit this alert to choose a future expiration.";
}
