export interface SepaCountry {
  code: string;
  name: string;
}

export const SEPA_COUNTRIES: SepaCountry[] = [
  { code: "ALA", name: "Åland Islands" },
  { code: "AND", name: "Andorra" },
  { code: "AUT", name: "Austria" },
  { code: "BEL", name: "Belgium" },
  { code: "BGR", name: "Bulgaria" },
  { code: "HRV", name: "Croatia" },
  { code: "CYP", name: "Cyprus" },
  { code: "CZE", name: "Czechia" },
  { code: "DNK", name: "Denmark" },
  { code: "EST", name: "Estonia" },
  { code: "FIN", name: "Finland" },
  { code: "FRA", name: "France" },
  { code: "GUF", name: "French Guiana" },
  { code: "DEU", name: "Germany" },
  { code: "GRC", name: "Greece" },
  { code: "GLP", name: "Guadeloupe" },
  { code: "HUN", name: "Hungary" },
  { code: "ISL", name: "Iceland" },
  { code: "IRL", name: "Ireland" },
  { code: "ITA", name: "Italy" },
  { code: "LVA", name: "Latvia" },
  { code: "LIE", name: "Liechtenstein" },
  { code: "LTU", name: "Lithuania" },
  { code: "LUX", name: "Luxembourg" },
  { code: "MLT", name: "Malta" },
  { code: "MTQ", name: "Martinique" },
  { code: "MYT", name: "Mayotte" },
  { code: "NLD", name: "Netherlands" },
  { code: "NOR", name: "Norway" },
  { code: "POL", name: "Poland" },
  { code: "PRT", name: "Portugal" },
  { code: "REU", name: "Réunion" },
  { code: "ROU", name: "Romania" },
  { code: "MAF", name: "Saint Martin" },
  { code: "SVK", name: "Slovakia" },
  { code: "SVN", name: "Slovenia" },
  { code: "ESP", name: "Spain" },
  { code: "SWE", name: "Sweden" },
  { code: "CHE", name: "Switzerland" },
  { code: "GBR", name: "United Kingdom" },
];

export function getSepaCountryName(code: string): string | undefined {
  return SEPA_COUNTRIES.find((c) => c.code === code)?.name;
}
