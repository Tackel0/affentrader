import { chartRating } from "../lib/ta/chartRating";
import { unpackRatingCandles, type ChartRatingRequest, type ChartRatingResponse } from "../lib/ta/chartRatingWire";

self.onmessage = ({ data }: MessageEvent<ChartRatingRequest>) => {
  const result: ChartRatingResponse = {
    id: data.id,
    view: chartRating(unpackRatingCandles(data.candles), data.context),
  };
  self.postMessage(result);
};
