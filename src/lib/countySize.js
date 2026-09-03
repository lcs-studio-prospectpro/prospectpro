// County size lookup — used to keep "search by county" territories honest against the same
// mile-radius caps that bound "search by zip + radius" territories (see plans.js radiusLimit).
// Without this, a Basic-tier account could pick a huge county (e.g. San Bernardino County, CA
// at ~20,068 sq mi) as its one territory and get far more coverage than even an Enterprise
// zip+radius search (150mi cap) — this closes that gap.
//
// Data source: U.S. Census Bureau 2023 Gazetteer Files (public domain), ALAND_SQMI field for
// all 3,222 county-equivalents (counties, parishes, boroughs, census areas, independent cities).
// A county's "footprint radius" is estimated as the radius of a circle with the same land area
// (r = sqrt(area / pi)) — a reasonable proxy for "how far could a rep have to drive corner-to-corner".
const COUNTY_AREA_SQMI = require('./countyAreaSqMi.json');

function normalizeCountyName(name) {
  return name.trim().toUpperCase().replace(/\s+/g, ' ');
}

const SUFFIXES = ['COUNTY', 'PARISH', 'BOROUGH', 'CENSUS AREA', 'CITY AND BOROUGH', 'MUNICIPALITY', 'MUNICIPIO'];

// Returns the estimated coverage radius (miles) for a given state + county name, or null if
// no match was found in the dataset (e.g. unusual naming — we fail open rather than block
// legitimate territory creation on a data-matching miss).
function estimatedCountyRadiusMiles(stateUsps, countyName) {
  if (!stateUsps || !countyName) return null;
  const state = stateUsps.trim().toUpperCase();
  const base = normalizeCountyName(countyName);
  // Try as typed first, then with common suffixes appended (users often type "Suffolk" not
  // "Suffolk County", or vice versa) — first match wins.
  const candidates = [base, ...SUFFIXES.map(sfx => `${base} ${sfx}`)];
  for (const candidate of candidates) {
    const sqmi = COUNTY_AREA_SQMI[`${state}|${candidate}`];
    if (sqmi != null) return Math.sqrt(sqmi / Math.PI);
  }
  return null; // no confident match — fail open, don't block legitimate territory creation
}

module.exports = { estimatedCountyRadiusMiles, COUNTY_AREA_SQMI };
