// Explicit sample road estimates: these are not straight-line calculations or
// a live traffic/routing result. The road table is stable for repeatable review.
import { sampleTourListings } from "./property-fixtures.mjs";

const minutes = [
  [0, 8, 14, 20, 27, 33],
  [9, 0, 7, 13, 20, 26],
  [15, 8, 0, 8, 14, 21],
  [21, 14, 9, 0, 7, 14],
  [28, 21, 15, 8, 0, 8],
  [34, 27, 22, 15, 9, 0],
];
const meters = [
  [0, 4100, 8300, 12300, 17600, 21400],
  [4300, 0, 3900, 7900, 13200, 17300],
  [8600, 4200, 0, 4500, 9600, 13800],
  [12700, 8200, 4700, 0, 5100, 9200],
  [18100, 13700, 10000, 5400, 0, 4300],
  [22100, 17800, 14100, 9700, 4600, 0],
];
export const sampleTourPoints = Object.fromEntries(sampleTourListings.map(listing => [listing.id, listing.coordinates]));
sampleTourPoints["sample-coastal"] = { lat: 26.128, lng: -80.104 };
sampleTourPoints["sample-courtyard"] = { lat: 26.119, lng: -80.162 };
sampleTourPoints["sample-condo"] = { lat: 26.098, lng: -80.142 };
export function sampleRoadMatrix(listingIds) {
  const indexes = listingIds.map(id => sampleTourListings.findIndex(listing => listing.id === id));
  return indexes.map((from, row) => indexes.map((to, column) => row === column ? { durationSeconds: 0, distanceMeters: 0 } : from < 0 || to < 0 ? { durationSeconds: null, distanceMeters: null } : { durationSeconds: minutes[from][to] * 60, distanceMeters: meters[from][to] }));
}
const endpoints = {
  "sample fortmark office": { coordinates: { lat: 26.087, lng: -80.337 }, to: [7, 13, 19, 25, 32, 38], from: [8, 14, 20, 26, 33, 39], meters: [3200, 7600, 11900, 16200, 21400, 25800] },
  "sample client meeting point": { coordinates: { lat: 26.112, lng: -80.267 }, to: [17, 11, 6, 9, 15, 22], from: [18, 12, 7, 10, 16, 23], meters: [11500, 7200, 3100, 5200, 9400, 14000] },
  "sample coastal meeting point": { coordinates: { lat: 26.137, lng: -80.132 }, to: [36, 30, 23, 16, 9, 5], from: [37, 31, 24, 17, 10, 6], meters: [24100, 19600, 15400, 11000, 6500, 2300] },
};
/** Resolve only the explicitly named fictional endpoints. Never geocode. */
export function sampleEndpointOptions(value, listingIds) {
  const resolve = address => {
    const endpoint = endpoints[address.trim().toLowerCase().replace(/\s+/g, " ")];
    if (!endpoint) { const error = new Error("unresolved_endpoint"); error.code = "unresolved_endpoint"; error.status = 422; throw error; }
    return endpoint;
  };
  const cells = (endpoint, direction) => listingIds.map(id => { const index = sampleTourListings.findIndex(listing => listing.id === id); return index < 0 ? { durationSeconds: null, distanceMeters: null } : { durationSeconds: endpoint[direction][index] * 60, distanceMeters: endpoint.meters[index] }; });
  const origin = value.originAddress?.trim() ? resolve(value.originAddress) : null;
  const mode = value.endMode || (value.returnToStart ? "return_to_start" : "last_property");
  const destination = mode === "address" ? resolve(value.endAddress || "") : mode === "return_to_start" && origin ? origin : null;
  return { options: { ...(origin ? { originTravel: cells(origin, "to") } : {}), ...(destination ? { endTravel: cells(destination, "from") } : {}), returnToStart: mode === "return_to_start" && !origin },
    ...(origin ? { originPoint: { ...origin.coordinates } } : {}), ...(destination ? { destinationPoint: { ...destination.coordinates } } : {}) };
}
