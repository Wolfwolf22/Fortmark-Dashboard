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
