export type CurrencyInfo = {
  code: string
  name: string
  symbol: string
  country: string
}

export const CURRENCY_LIST: CurrencyInfo[] = [
  { code: "AED", name: "UAE Dirham", symbol: "د.إ", country: "United Arab Emirates" },
  { code: "AFN", name: "Afghan Afghani", symbol: "؋", country: "Afghanistan" },
  { code: "ALL", name: "Albanian Lek", symbol: "L", country: "Albania" },
  { code: "AMD", name: "Armenian Dram", symbol: "֏", country: "Armenia" },
  { code: "ANG", name: "Netherlands Antillean Guilder", symbol: "ƒ", country: "Netherlands Antilles" },
  { code: "AOA", name: "Angolan Kwanza", symbol: "Kz", country: "Angola" },
  { code: "ARS", name: "Argentine Peso", symbol: "$", country: "Argentina" },
  { code: "AUD", name: "Australian Dollar", symbol: "A$", country: "Australia" },
  { code: "AWG", name: "Aruban Florin", symbol: "ƒ", country: "Aruba" },
  { code: "AZN", name: "Azerbaijani Manat", symbol: "₼", country: "Azerbaijan" },
  { code: "BAM", name: "Bosnia-Herzegovina Convertible Mark", symbol: "KM", country: "Bosnia and Herzegovina" },
  { code: "BBD", name: "Barbadian Dollar", symbol: "Bds$", country: "Barbados" },
  { code: "BDT", name: "Bangladeshi Taka", symbol: "৳", country: "Bangladesh" },
  { code: "BGN", name: "Bulgarian Lev", symbol: "лв", country: "Bulgaria" },
  { code: "BHD", name: "Bahraini Dinar", symbol: ".د.ب", country: "Bahrain" },
  { code: "BIF", name: "Burundian Franc", symbol: "Fr", country: "Burundi" },
  { code: "BMD", name: "Bermudian Dollar", symbol: "$", country: "Bermuda" },
  { code: "BND", name: "Brunei Dollar", symbol: "B$", country: "Brunei" },
  { code: "BOB", name: "Bolivian Boliviano", symbol: "Bs.", country: "Bolivia" },
  { code: "BRL", name: "Brazilian Real", symbol: "R$", country: "Brazil" },
  { code: "BSD", name: "Bahamian Dollar", symbol: "$", country: "Bahamas" },
  { code: "BTN", name: "Bhutanese Ngultrum", symbol: "Nu", country: "Bhutan" },
  { code: "BWP", name: "Botswanan Pula", symbol: "P", country: "Botswana" },
  { code: "BYN", name: "Belarusian Ruble", symbol: "Br", country: "Belarus" },
  { code: "BZD", name: "Belize Dollar", symbol: "BZ$", country: "Belize" },
  { code: "CAD", name: "Canadian Dollar", symbol: "C$", country: "Canada" },
  { code: "CDF", name: "Congolese Franc", symbol: "Fr", country: "Democratic Republic of the Congo" },
  { code: "CHF", name: "Swiss Franc", symbol: "Fr", country: "Switzerland" },
  { code: "CLP", name: "Chilean Peso", symbol: "$", country: "Chile" },
  { code: "CNY", name: "Chinese Yuan", symbol: "¥", country: "China" },
  { code: "COP", name: "Colombian Peso", symbol: "$", country: "Colombia" },
  { code: "CRC", name: "Costa Rican Colón", symbol: "₡", country: "Costa Rica" },
  { code: "CUP", name: "Cuban Peso", symbol: "$", country: "Cuba" },
  { code: "CVE", name: "Cape Verdean Escudo", symbol: "$", country: "Cape Verde" },
  { code: "CZK", name: "Czech Koruna", symbol: "Kč", country: "Czech Republic" },
  { code: "DJF", name: "Djiboutian Franc", symbol: "Fr", country: "Djibouti" },
  { code: "DKK", name: "Danish Krone", symbol: "kr", country: "Denmark" },
  { code: "DOP", name: "Dominican Peso", symbol: "RD$", country: "Dominican Republic" },
  { code: "DZD", name: "Algerian Dinar", symbol: "د.ج", country: "Algeria" },
  { code: "EGP", name: "Egyptian Pound", symbol: "£", country: "Egypt" },
  { code: "ERN", name: "Eritrean Nakfa", symbol: "Nfk", country: "Eritrea" },
  { code: "ETB", name: "Ethiopian Birr", symbol: "Br", country: "Ethiopia" },
  { code: "EUR", name: "Euro", symbol: "€", country: "Eurozone" },
  { code: "FJD", name: "Fijian Dollar", symbol: "FJ$", country: "Fiji" },
  { code: "FKP", name: "Falkland Islands Pound", symbol: "£", country: "Falkland Islands" },
  { code: "GBP", name: "British Pound Sterling", symbol: "£", country: "United Kingdom" },
  { code: "GEL", name: "Georgian Lari", symbol: "₾", country: "Georgia" },
  { code: "GHS", name: "Ghanaian Cedi", symbol: "₵", country: "Ghana" },
  { code: "GIP", name: "Gibraltar Pound", symbol: "£", country: "Gibraltar" },
  { code: "GMD", name: "Gambian Dalasi", symbol: "D", country: "Gambia" },
  { code: "GNF", name: "Guinean Franc", symbol: "Fr", country: "Guinea" },
  { code: "GTQ", name: "Guatemalan Quetzal", symbol: "Q", country: "Guatemala" },
  { code: "GYD", name: "Guyanaese Dollar", symbol: "$", country: "Guyana" },
  { code: "HKD", name: "Hong Kong Dollar", symbol: "HK$", country: "Hong Kong" },
  { code: "HNL", name: "Honduran Lempira", symbol: "L", country: "Honduras" },
  { code: "HRK", name: "Croatian Kuna", symbol: "kn", country: "Croatia" },
  { code: "HTG", name: "Haitian Gourde", symbol: "G", country: "Haiti" },
  { code: "HUF", name: "Hungarian Forint", symbol: "Ft", country: "Hungary" },
  { code: "IDR", name: "Indonesian Rupiah", symbol: "Rp", country: "Indonesia" },
  { code: "ILS", name: "Israeli New Shekel", symbol: "₪", country: "Israel" },
  { code: "INR", name: "Indian Rupee", symbol: "₹", country: "India" },
  { code: "IQD", name: "Iraqi Dinar", symbol: "ع.د", country: "Iraq" },
  { code: "IRR", name: "Iranian Rial", symbol: "﷼", country: "Iran" },
  { code: "ISK", name: "Icelandic Króna", symbol: "kr", country: "Iceland" },
  { code: "JMD", name: "Jamaican Dollar", symbol: "J$", country: "Jamaica" },
  { code: "JOD", name: "Jordanian Dinar", symbol: "د.ا", country: "Jordan" },
  { code: "JPY", name: "Japanese Yen", symbol: "¥", country: "Japan" },
  { code: "KES", name: "Kenyan Shilling", symbol: "Ksh", country: "Kenya" },
  { code: "KGS", name: "Kyrgystani Som", symbol: "с", country: "Kyrgyzstan" },
  { code: "KHR", name: "Cambodian Riel", symbol: "៛", country: "Cambodia" },
  { code: "KMF", name: "Comorian Franc", symbol: "Fr", country: "Comoros" },
  { code: "KPW", name: "North Korean Won", symbol: "₩", country: "North Korea" },
  { code: "KRW", name: "South Korean Won", symbol: "₩", country: "South Korea" },
  { code: "KWD", name: "Kuwaiti Dinar", symbol: "د.ك", country: "Kuwait" },
  { code: "KYD", name: "Cayman Islands Dollar", symbol: "$", country: "Cayman Islands" },
  { code: "KZT", name: "Kazakhstani Tenge", symbol: "₸", country: "Kazakhstan" },
  { code: "LAK", name: "Laotian Kip", symbol: "₭", country: "Laos" },
  { code: "LBP", name: "Lebanese Pound", symbol: "ل.ل", country: "Lebanon" },
  { code: "LKR", name: "Sri Lankan Rupee", symbol: "Rs", country: "Sri Lanka" },
  { code: "LRD", name: "Liberian Dollar", symbol: "$", country: "Liberia" },
  { code: "LSL", name: "Lesotho Loti", symbol: "L", country: "Lesotho" },
  { code: "LYD", name: "Libyan Dinar", symbol: "ل.د", country: "Libya" },
  { code: "MAD", name: "Moroccan Dirham", symbol: "د.م.", country: "Morocco" },
  { code: "MDL", name: "Moldovan Leu", symbol: "L", country: "Moldova" },
  { code: "MGA", name: "Malagasy Ariary", symbol: "Ar", country: "Madagascar" },
  { code: "MKD", name: "Macedonian Denar", symbol: "ден", country: "North Macedonia" },
  { code: "MMK", name: "Myanma Kyat", symbol: "K", country: "Myanmar" },
  { code: "MNT", name: "Mongolian Tögrög", symbol: "₮", country: "Mongolia" },
  { code: "MOP", name: "Macanese Pataca", symbol: "P", country: "Macau" },
  { code: "MRU", name: "Mauritanian Ouguiya", symbol: "UM", country: "Mauritania" },
  { code: "MUR", name: "Mauritian Rupee", symbol: "Rs", country: "Mauritius" },
  { code: "MVR", name: "Maldivian Rufiyaa", symbol: "Rf", country: "Maldives" },
  { code: "MWK", name: "Malawian Kwacha", symbol: "MK", country: "Malawi" },
  { code: "MXN", name: "Mexican Peso", symbol: "$", country: "Mexico" },
  { code: "MYR", name: "Malaysian Ringgit", symbol: "RM", country: "Malaysia" },
  { code: "MZN", name: "Mozambican Metical", symbol: "MT", country: "Mozambique" },
  { code: "NAD", name: "Namibian Dollar", symbol: "$", country: "Namibia" },
  { code: "NGN", name: "Nigerian Naira", symbol: "₦", country: "Nigeria" },
  { code: "NIO", name: "Nicaraguan Córdoba", symbol: "C$", country: "Nicaragua" },
  { code: "NOK", name: "Norwegian Krone", symbol: "kr", country: "Norway" },
  { code: "NPR", name: "Nepalese Rupee", symbol: "Rs", country: "Nepal" },
  { code: "NZD", name: "New Zealand Dollar", symbol: "NZ$", country: "New Zealand" },
  { code: "OMR", name: "Omani Rial", symbol: "ر.ع.", country: "Oman" },
  { code: "PAB", name: "Panamanian Balboa", symbol: "B/.", country: "Panama" },
  { code: "PEN", name: "Peruvian Sol", symbol: "S/", country: "Peru" },
  { code: "PGK", name: "Papua New Guinean Kina", symbol: "K", country: "Papua New Guinea" },
  { code: "PHP", name: "Philippine Peso", symbol: "₱", country: "Philippines" },
  { code: "PKR", name: "Pakistani Rupee", symbol: "Rs", country: "Pakistan" },
  { code: "PLN", name: "Polish Złoty", symbol: "zł", country: "Poland" },
  { code: "PYG", name: "Paraguayan Guaraní", symbol: "₲", country: "Paraguay" },
  { code: "QAR", name: "Qatari Riyal", symbol: "ر.ق", country: "Qatar" },
  { code: "RON", name: "Romanian Leu", symbol: "lei", country: "Romania" },
  { code: "RSD", name: "Serbian Dinar", symbol: "din", country: "Serbia" },
  { code: "RUB", name: "Russian Ruble", symbol: "₽", country: "Russia" },
  { code: "RWF", name: "Rwandan Franc", symbol: "Fr", country: "Rwanda" },
  { code: "SAR", name: "Saudi Riyal", symbol: "ر.س", country: "Saudi Arabia" },
  { code: "SBD", name: "Solomon Islands Dollar", symbol: "$", country: "Solomon Islands" },
  { code: "SCR", name: "Seychellois Rupee", symbol: "Rs", country: "Seychelles" },
  { code: "SDG", name: "Sudanese Pound", symbol: "ج.س.", country: "Sudan" },
  { code: "SEK", name: "Swedish Krona", symbol: "kr", country: "Sweden" },
  { code: "SGD", name: "Singapore Dollar", symbol: "S$", country: "Singapore" },
  { code: "SHP", name: "Saint Helena Pound", symbol: "£", country: "Saint Helena" },
  { code: "SLL", name: "Sierra Leonean Leone", symbol: "Le", country: "Sierra Leone" },
  { code: "SOS", name: "Somali Shilling", symbol: "Sh", country: "Somalia" },
  { code: "SRD", name: "Surinamese Dollar", symbol: "$", country: "Suriname" },
  { code: "STN", name: "São Tomé and Príncipe Dobra", symbol: "Db", country: "São Tomé and Príncipe" },
  { code: "SVC", name: "Salvadoran Colón", symbol: "₡", country: "El Salvador" },
  { code: "SYP", name: "Syrian Pound", symbol: "£", country: "Syria" },
  { code: "SZL", name: "Swazi Lilangeni", symbol: "L", country: "Eswatini" },
  { code: "THB", name: "Thai Baht", symbol: "฿", country: "Thailand" },
  { code: "TJS", name: "Tajikistani Somoni", symbol: "SM", country: "Tajikistan" },
  { code: "TMT", name: "Turkmenistani Manat", symbol: "T", country: "Turkmenistan" },
  { code: "TND", name: "Tunisian Dinar", symbol: "د.ت", country: "Tunisia" },
  { code: "TOP", name: "Tongan Paʻanga", symbol: "T$", country: "Tonga" },
  { code: "TRY", name: "Turkish Lira", symbol: "₺", country: "Turkey" },
  { code: "TTD", name: "Trinidad and Tobago Dollar", symbol: "TT$", country: "Trinidad and Tobago" },
  { code: "TWD", name: "New Taiwan Dollar", symbol: "NT$", country: "Taiwan" },
  { code: "TZS", name: "Tanzanian Shilling", symbol: "Sh", country: "Tanzania" },
  { code: "UAH", name: "Ukrainian Hryvnia", symbol: "₴", country: "Ukraine" },
  { code: "UGX", name: "Ugandan Shilling", symbol: "Sh", country: "Uganda" },
  { code: "USD", name: "US Dollar", symbol: "$", country: "United States" },
  { code: "UYU", name: "Uruguayan Peso", symbol: "$U", country: "Uruguay" },
  { code: "UZS", name: "Uzbekistani Som", symbol: "so'm", country: "Uzbekistan" },
  { code: "VES", name: "Venezuelan Bolívar", symbol: "Bs.S", country: "Venezuela" },
  { code: "VND", name: "Vietnamese Đồng", symbol: "₫", country: "Vietnam" },
  { code: "VUV", name: "Vanuatu Vatu", symbol: "Vt", country: "Vanuatu" },
  { code: "WST", name: "Samoan Tālā", symbol: "T", country: "Samoa" },
  { code: "XAF", name: "Central African CFA Franc", symbol: "Fr", country: "Central Africa" },
  { code: "XCD", name: "East Caribbean Dollar", symbol: "EC$", country: "East Caribbean" },
  { code: "XOF", name: "West African CFA Franc", symbol: "Fr", country: "West Africa" },
  { code: "XPF", name: "CFP Franc", symbol: "Fr", country: "French Polynesia" },
  { code: "YER", name: "Yemeni Rial", symbol: "﷼", country: "Yemen" },
  { code: "ZAR", name: "South African Rand", symbol: "R", country: "South Africa" },
  { code: "ZMW", name: "Zambian Kwacha", symbol: "ZK", country: "Zambia" },
  { code: "ZWL", name: "Zimbabwean Dollar", symbol: "$", country: "Zimbabwe" },
]

export function getCurrencySymbol(code: string): string {
  return CURRENCY_LIST.find((c) => c.code === code)?.symbol ?? code
}

/**
 * ISO 3166-1 alpha-2 country code → default currency code. Covers major markets;
 * anything not listed falls back to USD via `currencyForCountry`. Eurozone members
 * all map to EUR.
 */
export const COUNTRY_TO_CURRENCY: Record<string, string> = {
  // North America
  US: "USD", CA: "CAD", MX: "MXN",
  // Eurozone
  AT: "EUR", BE: "EUR", CY: "EUR", EE: "EUR", FI: "EUR", FR: "EUR", DE: "EUR",
  GR: "EUR", IE: "EUR", IT: "EUR", LV: "EUR", LT: "EUR", LU: "EUR", MT: "EUR",
  NL: "EUR", PT: "EUR", SK: "EUR", SI: "EUR", ES: "EUR", HR: "EUR",
  // Rest of Europe
  GB: "GBP", CH: "CHF", NO: "NOK", SE: "SEK", DK: "DKK", PL: "PLN", CZ: "CZK",
  HU: "HUF", RO: "RON", BG: "BGN", UA: "UAH", RU: "RUB", TR: "TRY", IS: "ISK",
  // Middle East
  AE: "AED", SA: "SAR", QA: "QAR", KW: "KWD", BH: "BHD", OM: "OMR", IL: "ILS",
  JO: "JOD", LB: "LBP",
  // Asia-Pacific
  IN: "INR", CN: "CNY", JP: "JPY", KR: "KRW", SG: "SGD", HK: "HKD", TW: "TWD",
  MY: "MYR", TH: "THB", ID: "IDR", PH: "PHP", VN: "VND", PK: "PKR", BD: "BDT",
  LK: "LKR", NP: "NPR", AU: "AUD", NZ: "NZD",
  // Africa
  ZA: "ZAR", NG: "NGN", EG: "EGP", KE: "KES", GH: "GHS", MA: "MAD", TZ: "TZS",
  UG: "UGX",
  // Latin America
  BR: "BRL", AR: "ARS", CL: "CLP", CO: "COP", PE: "PEN", UY: "UYU",
}

/**
 * Resolve a likely default currency for an ISO alpha-2 country code. Returns "USD"
 * when the code is missing or unmapped.
 */
export function currencyForCountry(code?: string | null): string {
  if (!code) return "USD"
  return COUNTRY_TO_CURRENCY[code.toUpperCase()] ?? "USD"
}

/**
 * IANA timezone → ISO alpha-2 country. Curated for the common zones of the markets
 * in COUNTRY_TO_CURRENCY. Used to infer location client-side — this works in local
 * dev (and anywhere) where the Vercel `x-vercel-ip-country` header is absent.
 * Unmapped zones fall back to the browser locale region in `detectCountryCode`.
 */
const TIMEZONE_TO_COUNTRY: Record<string, string> = {
  // North America
  "America/New_York": "US", "America/Detroit": "US", "America/Chicago": "US",
  "America/Denver": "US", "America/Phoenix": "US", "America/Los_Angeles": "US",
  "America/Anchorage": "US", "Pacific/Honolulu": "US",
  "America/Toronto": "CA", "America/Vancouver": "CA", "America/Edmonton": "CA",
  "America/Winnipeg": "CA", "America/Halifax": "CA",
  "America/Mexico_City": "MX", "America/Monterrey": "MX", "America/Tijuana": "MX",
  // Europe
  "Europe/London": "GB", "Europe/Dublin": "IE", "Europe/Lisbon": "PT",
  "Europe/Madrid": "ES", "Europe/Paris": "FR", "Europe/Brussels": "BE",
  "Europe/Amsterdam": "NL", "Europe/Berlin": "DE", "Europe/Rome": "IT",
  "Europe/Vienna": "AT", "Europe/Zurich": "CH", "Europe/Luxembourg": "LU",
  "Europe/Athens": "GR", "Europe/Helsinki": "FI", "Europe/Tallinn": "EE",
  "Europe/Riga": "LV", "Europe/Vilnius": "LT", "Europe/Malta": "MT",
  "Europe/Nicosia": "CY", "Europe/Bratislava": "SK", "Europe/Ljubljana": "SI",
  "Europe/Zagreb": "HR", "Europe/Oslo": "NO", "Europe/Stockholm": "SE",
  "Europe/Copenhagen": "DK", "Europe/Warsaw": "PL", "Europe/Prague": "CZ",
  "Europe/Budapest": "HU", "Europe/Bucharest": "RO", "Europe/Sofia": "BG",
  "Europe/Kyiv": "UA", "Europe/Kiev": "UA", "Europe/Moscow": "RU",
  "Europe/Istanbul": "TR", "Atlantic/Reykjavik": "IS",
  // Middle East
  "Asia/Dubai": "AE", "Asia/Riyadh": "SA", "Asia/Qatar": "QA", "Asia/Kuwait": "KW",
  "Asia/Bahrain": "BH", "Asia/Muscat": "OM", "Asia/Jerusalem": "IL",
  "Asia/Amman": "JO", "Asia/Beirut": "LB",
  // Asia-Pacific
  "Asia/Kolkata": "IN", "Asia/Calcutta": "IN", "Asia/Shanghai": "CN",
  "Asia/Hong_Kong": "HK", "Asia/Taipei": "TW", "Asia/Tokyo": "JP",
  "Asia/Seoul": "KR", "Asia/Singapore": "SG", "Asia/Kuala_Lumpur": "MY",
  "Asia/Bangkok": "TH", "Asia/Jakarta": "ID", "Asia/Manila": "PH",
  "Asia/Ho_Chi_Minh": "VN", "Asia/Karachi": "PK", "Asia/Dhaka": "BD",
  "Asia/Colombo": "LK", "Asia/Kathmandu": "NP",
  "Australia/Sydney": "AU", "Australia/Melbourne": "AU", "Australia/Brisbane": "AU",
  "Australia/Perth": "AU", "Australia/Adelaide": "AU", "Pacific/Auckland": "NZ",
  // Africa
  "Africa/Johannesburg": "ZA", "Africa/Lagos": "NG", "Africa/Cairo": "EG",
  "Africa/Nairobi": "KE", "Africa/Accra": "GH", "Africa/Casablanca": "MA",
  "Africa/Dar_es_Salaam": "TZ", "Africa/Kampala": "UG",
  // Latin America
  "America/Sao_Paulo": "BR", "America/Argentina/Buenos_Aires": "AR",
  "America/Santiago": "CL", "America/Bogota": "CO", "America/Lima": "PE",
  "America/Montevideo": "UY",
}

/**
 * Best-effort detection of the user's ISO alpha-2 country code, client-side.
 * Tries the device timezone first (reflects physical location, independent of
 * language), then the browser locale's region subtag. Returns undefined if neither
 * yields a usable code.
 */
export function detectCountryCode(): string | undefined {
  // 1. Timezone — most reliable location signal available without a network call.
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (tz && TIMEZONE_TO_COUNTRY[tz]) return TIMEZONE_TO_COUNTRY[tz]
  } catch {
    // Intl unavailable — fall through to locale.
  }
  // 2. Browser locale region (e.g. "en-US" → US, "zh-Hans-CN" → CN).
  if (typeof navigator !== "undefined") {
    const locales = [navigator.language, ...(navigator.languages ?? [])].filter(Boolean)
    for (const locale of locales) {
      try {
        const region = new Intl.Locale(locale).region
        if (region && region.length === 2) return region.toUpperCase()
      } catch {
        // Malformed locale tag — skip it.
      }
    }
  }
  return undefined
}

/**
 * Best-effort default currency for the current user, detected entirely client-side.
 * Falls back to USD when location cannot be determined.
 */
export function detectDefaultCurrency(fallback = "USD"): string {
  const country = detectCountryCode()
  return country ? currencyForCountry(country) : fallback
}
