import type { InstrumentType } from "./symbolId";

export type MarketTab = "crypto" | "perps" | "stock" | "etf" | "index" | "forex";

/** Instrument filters for the shared symbol search. */
export const MARKET_TABS: { id: MarketTab; label: string }[] = [
  { id: "crypto", label: "Crypto" },
  { id: "perps", label: "Perpetuals" },
  { id: "stock", label: "Stocks" },
  { id: "etf", label: "ETFs" },
  { id: "index", label: "Indices" },
  { id: "forex", label: "Forex" },
];

export interface StockExchange {
  id: string;
  label: string;
  /** Yahoo Finance ticker suffix; empty for US exchanges. */
  suffix: string;
  currency: string;
}

/** Exchanges whose listings Yahoo Finance serves, with their ticker suffix. */
export const STOCK_EXCHANGES: StockExchange[] = [
  { id: "us", label: "US (NYSE, NASDAQ)", suffix: "", currency: "USD" },
  { id: "lse", label: "London", suffix: ".L", currency: "GBP" },
  { id: "xetra", label: "Xetra (Germany)", suffix: ".DE", currency: "EUR" },
  { id: "paris", label: "Euronext Paris", suffix: ".PA", currency: "EUR" },
  { id: "amsterdam", label: "Euronext Amsterdam", suffix: ".AS", currency: "EUR" },
  { id: "milan", label: "Borsa Italiana", suffix: ".MI", currency: "EUR" },
  { id: "madrid", label: "Madrid", suffix: ".MC", currency: "EUR" },
  { id: "swiss", label: "SIX Swiss", suffix: ".SW", currency: "CHF" },
  { id: "stockholm", label: "Stockholm", suffix: ".ST", currency: "SEK" },
  { id: "toronto", label: "Toronto", suffix: ".TO", currency: "CAD" },
  { id: "tokyo", label: "Tokyo", suffix: ".T", currency: "JPY" },
  { id: "hongkong", label: "Hong Kong", suffix: ".HK", currency: "HKD" },
  { id: "shanghai", label: "Shanghai", suffix: ".SS", currency: "CNY" },
  { id: "korea", label: "Korea", suffix: ".KS", currency: "KRW" },
  { id: "india", label: "India (NSE)", suffix: ".NS", currency: "INR" },
  { id: "sydney", label: "Australia (ASX)", suffix: ".AX", currency: "AUD" },
  { id: "singapore", label: "Singapore", suffix: ".SI", currency: "SGD" },
  { id: "saopaulo", label: "São Paulo", suffix: ".SA", currency: "BRL" },
];

/** Which exchange a Yahoo ticker belongs to, judged by its suffix. */
export function exchangeOfTicker(ticker: string): StockExchange {
  const upper = ticker.toUpperCase();
  const match = STOCK_EXCHANGES.filter((e) => e.suffix && upper.endsWith(e.suffix)).sort((a, b) => b.suffix.length - a.suffix.length)[0];
  return match ?? STOCK_EXCHANGES[0];
}

const x = (ticker: string, name: string, exchange: string, currency: string): PopularInstrument => ({ ticker, name, exchange, currency });

/** Well-known listings per non-US exchange, shown before the user types. */
export const POPULAR_BY_EXCHANGE: Record<string, PopularInstrument[]> = {
  lse: [x("SHEL.L", "Shell plc", "LSE", "GBP"), x("AZN.L", "AstraZeneca PLC", "LSE", "GBP"), x("HSBA.L", "HSBC Holdings plc", "LSE", "GBP"), x("BP.L", "BP p.l.c.", "LSE", "GBP"), x("ULVR.L", "Unilever PLC", "LSE", "GBP"), x("GSK.L", "GSK plc", "LSE", "GBP"), x("RIO.L", "Rio Tinto Group", "LSE", "GBP"), x("VOD.L", "Vodafone Group Plc", "LSE", "GBP")],
  xetra: [x("SAP.DE", "SAP SE", "XETRA", "EUR"), x("SIE.DE", "Siemens AG", "XETRA", "EUR"), x("ALV.DE", "Allianz SE", "XETRA", "EUR"), x("BMW.DE", "Bayerische Motoren Werke AG", "XETRA", "EUR"), x("VOW3.DE", "Volkswagen AG", "XETRA", "EUR"), x("DTE.DE", "Deutsche Telekom AG", "XETRA", "EUR"), x("BAS.DE", "BASF SE", "XETRA", "EUR"), x("MBG.DE", "Mercedes-Benz Group AG", "XETRA", "EUR")],
  paris: [x("MC.PA", "LVMH Moët Hennessy Louis Vuitton", "Paris", "EUR"), x("OR.PA", "L'Oréal S.A.", "Paris", "EUR"), x("TTE.PA", "TotalEnergies SE", "Paris", "EUR"), x("SAN.PA", "Sanofi", "Paris", "EUR"), x("AIR.PA", "Airbus SE", "Paris", "EUR"), x("BNP.PA", "BNP Paribas SA", "Paris", "EUR")],
  amsterdam: [x("ASML.AS", "ASML Holding N.V.", "Amsterdam", "EUR"), x("ADYEN.AS", "Adyen N.V.", "Amsterdam", "EUR"), x("INGA.AS", "ING Groep N.V.", "Amsterdam", "EUR"), x("PHIA.AS", "Koninklijke Philips N.V.", "Amsterdam", "EUR")],
  milan: [x("ENEL.MI", "Enel SpA", "Milan", "EUR"), x("ISP.MI", "Intesa Sanpaolo S.p.A.", "Milan", "EUR"), x("UCG.MI", "UniCredit S.p.A.", "Milan", "EUR"), x("RACE.MI", "Ferrari N.V.", "Milan", "EUR")],
  madrid: [x("SAN.MC", "Banco Santander, S.A.", "Madrid", "EUR"), x("ITX.MC", "Industria de Diseño Textil", "Madrid", "EUR"), x("IBE.MC", "Iberdrola, S.A.", "Madrid", "EUR"), x("BBVA.MC", "Banco Bilbao Vizcaya Argentaria", "Madrid", "EUR")],
  swiss: [x("NESN.SW", "Nestlé S.A.", "SIX", "CHF"), x("NOVN.SW", "Novartis AG", "SIX", "CHF"), x("ROG.SW", "Roche Holding AG", "SIX", "CHF"), x("UBSG.SW", "UBS Group AG", "SIX", "CHF")],
  stockholm: [x("VOLV-B.ST", "AB Volvo (publ)", "Stockholm", "SEK"), x("ERIC-B.ST", "Telefonaktiebolaget LM Ericsson", "Stockholm", "SEK"), x("ATCO-A.ST", "Atlas Copco AB", "Stockholm", "SEK")],
  toronto: [x("SHOP.TO", "Shopify Inc.", "Toronto", "CAD"), x("RY.TO", "Royal Bank of Canada", "Toronto", "CAD"), x("TD.TO", "Toronto-Dominion Bank", "Toronto", "CAD"), x("ENB.TO", "Enbridge Inc.", "Toronto", "CAD")],
  tokyo: [x("7203.T", "Toyota Motor Corporation", "Tokyo", "JPY"), x("6758.T", "Sony Group Corporation", "Tokyo", "JPY"), x("9984.T", "SoftBank Group Corp.", "Tokyo", "JPY"), x("7974.T", "Nintendo Co., Ltd.", "Tokyo", "JPY")],
  hongkong: [x("0700.HK", "Tencent Holdings Limited", "Hong Kong", "HKD"), x("9988.HK", "Alibaba Group Holding Limited", "Hong Kong", "HKD"), x("1299.HK", "AIA Group Limited", "Hong Kong", "HKD"), x("0005.HK", "HSBC Holdings plc", "Hong Kong", "HKD")],
  shanghai: [x("600519.SS", "Kweichow Moutai Co., Ltd.", "Shanghai", "CNY"), x("601318.SS", "Ping An Insurance", "Shanghai", "CNY")],
  korea: [x("005930.KS", "Samsung Electronics Co., Ltd.", "Korea", "KRW"), x("000660.KS", "SK hynix Inc.", "Korea", "KRW")],
  india: [x("RELIANCE.NS", "Reliance Industries Limited", "NSE", "INR"), x("TCS.NS", "Tata Consultancy Services", "NSE", "INR"), x("INFY.NS", "Infosys Limited", "NSE", "INR"), x("HDFCBANK.NS", "HDFC Bank Limited", "NSE", "INR")],
  sydney: [x("BHP.AX", "BHP Group Limited", "ASX", "AUD"), x("CBA.AX", "Commonwealth Bank of Australia", "ASX", "AUD"), x("CSL.AX", "CSL Limited", "ASX", "AUD")],
  singapore: [x("D05.SI", "DBS Group Holdings Ltd", "SGX", "SGD"), x("O39.SI", "Oversea-Chinese Banking Corporation", "SGX", "SGD")],
  saopaulo: [x("PETR4.SA", "Petróleo Brasileiro S.A.", "B3", "BRL"), x("VALE3.SA", "Vale S.A.", "B3", "BRL")],
};

export interface PopularInstrument {
  ticker: string;
  name: string;
  exchange: string;
  currency: string;
}

const i = (ticker: string, name: string, exchange: string, currency = "USD"): PopularInstrument => ({ ticker, name, exchange, currency });

/** Suggestions shown before the user types anything. */
export const POPULAR: Record<Exclude<MarketTab, "crypto" | "perps">, PopularInstrument[]> = {
  stock: [
    i("AAPL", "Apple Inc.", "NASDAQ"),
    i("MSFT", "Microsoft Corporation", "NASDAQ"),
    i("NVDA", "NVIDIA Corporation", "NASDAQ"),
    i("AMZN", "Amazon.com, Inc.", "NASDAQ"),
    i("GOOGL", "Alphabet Inc.", "NASDAQ"),
    i("META", "Meta Platforms, Inc.", "NASDAQ"),
    i("TSLA", "Tesla, Inc.", "NASDAQ"),
    i("JPM", "JPMorgan Chase & Co.", "NYSE"),
    i("V", "Visa Inc.", "NYSE"),
    i("KO", "The Coca-Cola Company", "NYSE"),
    i("MSTR", "Strategy Inc", "NASDAQ"),
    i("COIN", "Coinbase Global, Inc.", "NASDAQ"),
  ],
  etf: [
    i("SPY", "SPDR S&P 500 ETF Trust", "NYSE Arca"),
    i("QQQ", "Invesco QQQ Trust", "NASDAQ"),
    i("IWM", "iShares Russell 2000 ETF", "NYSE Arca"),
    i("GLD", "SPDR Gold Shares", "NYSE Arca"),
    i("TLT", "iShares 20+ Year Treasury Bond ETF", "NASDAQ"),
    i("XLK", "Technology Select Sector SPDR", "NYSE Arca"),
    i("IBIT", "iShares Bitcoin Trust ETF", "NASDAQ"),
    i("ARKK", "ARK Innovation ETF", "NYSE Arca"),
  ],
  index: [
    i("^GSPC", "S&P 500", "SNP", "USD"),
    i("^IXIC", "NASDAQ Composite", "NASDAQ", "USD"),
    i("^DJI", "Dow Jones Industrial Average", "DJI", "USD"),
    i("^RUT", "Russell 2000", "Russell", "USD"),
    i("^VIX", "CBOE Volatility Index", "CBOE", "USD"),
    i("^FTSE", "FTSE 100", "FTSE", "GBP"),
    i("^GDAXI", "DAX Performance Index", "XETRA", "EUR"),
    i("^N225", "Nikkei 225", "Osaka", "JPY"),
    i("^HSI", "Hang Seng Index", "HKSE", "HKD"),
  ],
  forex: [
    i("EURUSD=X", "EUR/USD", "FX", "USD"),
    i("GBPUSD=X", "GBP/USD", "FX", "USD"),
    i("USDJPY=X", "USD/JPY", "FX", "JPY"),
    i("AUDUSD=X", "AUD/USD", "FX", "USD"),
    i("USDCAD=X", "USD/CAD", "FX", "CAD"),
    i("USDCHF=X", "USD/CHF", "FX", "CHF"),
    i("EURGBP=X", "EUR/GBP", "FX", "GBP"),
    i("BTC-USD", "Bitcoin USD", "CCC", "USD"),
  ],
};

export const TYPE_FOR_TAB: Record<Exclude<MarketTab, "crypto" | "perps">, InstrumentType> = {
  stock: "stock",
  etf: "etf",
  index: "index",
  forex: "forex",
};
