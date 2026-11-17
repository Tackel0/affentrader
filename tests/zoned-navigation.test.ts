import {describe,expect,it} from "vitest";
import {wallDateTime,wallTimeCandidates,offsetLabel,resolveZone} from "@/lib/timezones";
import {dateWindow,navigationDepth} from "@/lib/chart/ranges";
import {registerSymbolInfo} from "@/lib/symbolId";
const utc=(value:string)=>Date.parse(`${value}Z`);
describe("chart-zone date navigation",()=>{
  it.each([
    ["UTC","2026-10-26T10:00","2026-10-26T10:00:00"],
    ["America/New_York","1960-01-15T09:30","1960-01-15T14:30:00"],
    ["America/New_York","2026-01-15T09:30","2026-01-15T14:30:00"],
    ["America/New_York","2026-07-15T09:30","2026-07-15T13:30:00"],
    ["Asia/Kolkata","2026-10-26T09:30","2026-10-26T04:00:00"],
    ["Asia/Kathmandu","2026-10-26T00:15","2026-10-25T18:30:00"],
    ["Pacific/Kiritimati","2026-10-26T00:15","2026-10-25T10:15:00"],
  ])("round-trips %s wall time %s",(zone,wall,instant)=>{expect(wallTimeCandidates(wall,zone)).toEqual([utc(instant)]);expect(wallDateTime(utc(instant),zone)).toBe(wall);});
  it.each([["Europe/Berlin","2026-03-29T02:30"],["America/New_York","2026-03-08T02:30"],["Australia/Lord_Howe","2026-10-04T02:15"],["Pacific/Apia","2011-12-30T12:00"]])("rejects skipped local time in %s",(zone,wall)=>expect(wallTimeCandidates(wall,zone)).toEqual([]));
  it("offers both European fall-back instants with distinct offsets",()=>{
    const wall="2026-10-25T02:30",times=wallTimeCandidates(wall,"Europe/Berlin");expect(times).toEqual([utc("2026-10-25T00:30:00"),utc("2026-10-25T01:30:00")]);expect(times.map(time=>offsetLabel("Europe/Berlin",new Date(time)))).toEqual(["UTC+2","UTC+1"]);expect(times.map(time=>wallDateTime(time,"Europe/Berlin"))).toEqual([wall,wall]);
  });
  it("handles an American fold and a thirty-minute Australian fold",()=>{
    expect(wallTimeCandidates("2026-11-01T01:30","America/New_York")).toEqual([utc("2026-11-01T05:30:00"),utc("2026-11-01T06:30:00")]);expect(wallTimeCandidates("2026-04-05T01:45","Australia/Lord_Howe")).toEqual([utc("2026-04-04T14:45:00"),utc("2026-04-04T15:15:00")]);
  });
  it("orders custom ranges by their instants even when wall-clock endpoints are equal",()=>{
    const [first,second]=wallTimeCandidates("2026-10-25T02:30","Europe/Berlin");expect(dateWindow(first,second,"5m",utc("2026-10-26T12:00:00"))).toEqual({from:first,to:second});expect(()=>dateWindow(second,first,"5m",utc("2026-10-26T12:00:00"))).toThrow(/end after/);
  });
  it("uses the registered exchange's zone for the same wall-clock resolver",()=>{
    registerSymbolInfo({symbol:"YF:ZONETEST",name:"Zone test",exchange:"NASDAQ",currency:"USD",type:"stock",delayed:true,timezone:"America/New_York"});const zone=resolveZone("exchange","YF:ZONETEST");expect(wallTimeCandidates("2026-10-26T09:30",zone)).toEqual([utc("2026-10-26T13:30:00")]);
  });
  it("supports real pre-epoch dates at an interval that fits the bounded history window",()=>{
    const [time]=wallTimeCandidates("1960-01-15T09:30","America/New_York"),window=dateWindow(time,undefined,"1W",utc("2026-10-26T12:00:00"));expect(window.from).toBeLessThan(time);expect(window.to).toBeGreaterThan(time);expect(navigationDepth(time,"1W",utc("2026-10-26T12:00:00"))).toBeLessThan(20000);
  });
  it.each(["","2026-02-30T10:00","2026-10-26T24:00","2026-10-26","2026-10-26T10:00Z"])("does not normalize invalid input %s",input=>expect(wallTimeCandidates(input,"UTC")).toEqual([]));
});
