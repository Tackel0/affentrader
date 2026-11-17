import { buildSessionVolumeProfiles } from "../lib/orderflow/volumeProfileModel";
import { profileTradingCalendar, profileCalendarKey } from "../lib/orderflow/profileTradingHours";
import { unpackSessionTrades, type SessionProfileRequest, type SessionProfileResponse } from "../lib/orderflow/sessionProfileJobs";

const calendars = new Map<string, ReturnType<typeof profileTradingCalendar>>();
self.onmessage = (event: MessageEvent<SessionProfileRequest>) => {
  const request = event.data;
  let response: SessionProfileResponse;
  try {
    const style = request.style, key = JSON.stringify([profileCalendarKey(style,request.symbol,request.calendar),request.calendar]);
    let calendar = calendars.get(key);
    if (!calendar) {
      calendar = profileTradingCalendar(style, request.symbol, request.calendar); calendars.set(key, calendar);
      if (calendars.size > 16) calendars.delete(calendars.keys().next().value!);
    }
    response = { id: request.id, model: buildSessionVolumeProfiles(unpackSessionTrades(request), style, request.symbol, calendar, request.timeframe) };
  } catch (error) { response = { id: request.id, error: error instanceof Error ? error.message : "Invalid session profile snapshot." }; }
  self.postMessage(response);
};
