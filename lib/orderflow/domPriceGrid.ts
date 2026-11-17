import { priceGridTick, type PriceGridLoader, type PriceGridMetadata } from "@/lib/market/priceGridMetadata";
export interface DomGridState { metadata?: PriceGridMetadata; pending: boolean; error: string }
export function validateDomGrid(symbol:string, metadata:PriceGridMetadata) {
  if (metadata.symbol!==symbol || typeof metadata.source!=="string" || !metadata.source.trim() || !Number.isSafeInteger(metadata.checkedAt) || metadata.checkedAt<0 || metadata.checkedAt>Date.now()+1000)
    throw new Error("Price-grid metadata does not match this market or has an invalid timestamp.");
  if (metadata.sizeDecimals!==undefined && (!Number.isInteger(metadata.sizeDecimals) || metadata.sizeDecimals<0 || metadata.sizeDecimals>6)) throw new Error("Invalid venue size precision.");
  priceGridTick(metadata,1);
}
/** One source-scoped request owner. Stop fences both pending promises and timers. */
export function watchDomGrid(symbol:string, load:PriceGridLoader, changed:(state:DomGridState)=>void) {
  let active=true, timer:ReturnType<typeof setTimeout>|undefined, metadata:PriceGridMetadata|undefined;
  const refresh=()=>{
    if(!active)return;
    changed({metadata,pending:true,error:""});
    void Promise.resolve().then(()=>active?load(symbol):null).then(value=>{
      if(!active || value===null)return;
      validateDomGrid(symbol,value); metadata={...value};
      changed({metadata,pending:false,error:""});
      timer=setTimeout(refresh,300000);
    }).catch(error=>{
      if(!active)return;
      changed({metadata,pending:false,error:error instanceof Error?error.message:"Venue grid unavailable."});
      timer=setTimeout(refresh,30000);
    });
  };
  refresh();
  return ()=>{active=false;if(timer!==undefined)clearTimeout(timer);};
}
export function domGridChoice(symbol:string, state:DomGridState, price:number|undefined, observed:number) {
  if(state.metadata){
    try { validateDomGrid(symbol,state.metadata);return {tick:priceGridTick(state.metadata,price),verified:true,source:state.metadata.source,checkedAt:state.metadata.checkedAt}; }
    catch { /* An unusable price-dependent grid must not masquerade as verified. */ }
  }
  return {tick:observed,verified:false,source:"First observed book spacing; not verified venue tick metadata",checkedAt:undefined};
}
