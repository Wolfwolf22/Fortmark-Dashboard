/**
 * The in-memory mock database. Built once per process from a fixed seed, so
 * every load renders identical data. Mutations from the UI (`create*`,
 * `update*` adapter calls) push into these arrays; a version bump makes
 * hooks refetch — the same shape a real mutation + revalidation has.
 */

import {
  Agent,
  AppNotification,
  CalendarEvent,
  Client,
  ComplianceItem,
  Lead,
  LeadSource,
  LeadStage,
  Listing,
  ListingStatus,
  MarketActivityItem,
  MessageThread,
  Milestone,
  MilestoneKey,
  PriceEvent,
  PropertyType,
  MILESTONE_LABELS,
  Transaction,
  TransactionDocument,
  TransactionStage,
  TRANSACTION_STAGES,
} from "../types";
import { chance, float, int, listingPrice, mulberry32, pick, shuffle } from "./random";

// Anchor "now" to the top of the current hour so server render and client
// hydration agree on every derived date within the hour.
const NOW = new Date();
NOW.setMinutes(0, 0, 0);
export const now = () => new Date(NOW);

const DAY = 86400000;
const iso = (d: Date) => d.toISOString();
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);
const daysAhead = (n: number) => new Date(NOW.getTime() + n * DAY);

const rng = mulberry32(20260127);

// ---------------------------------------------------------------------------
// Geography

interface Area {
  city: string;
  zip: string;
  neighborhoods: string[];
  streets: string[];
  priceBand: [number, number];
}

const AREAS: Area[] = [
  {
    city: "Fort Lauderdale",
    zip: "33301",
    neighborhoods: ["Victoria Park", "Colee Hammock", "Beverly Heights"],
    streets: ["NE 7th Ave", "Victoria Park Rd", "NE 17th Way", "E Broward Blvd", "NE 5th Ct"],
    priceBand: [650_000, 2_400_000],
  },
  {
    city: "Fort Lauderdale",
    zip: "33301",
    neighborhoods: ["Las Olas Isles", "Seven Isles", "Rio Vista"],
    streets: ["Isle of Venice Dr", "Hendricks Isle", "Royal Plaza Dr", "Ponce de Leon Dr", "SE 9th Ave"],
    priceBand: [1_400_000, 6_500_000],
  },
  {
    city: "Fort Lauderdale",
    zip: "33308",
    neighborhoods: ["Coral Ridge", "Coral Ridge Country Club", "Imperial Point"],
    streets: ["Bayview Dr", "NE 26th St", "NE 41st St", "Middle River Dr", "NE 32nd Ave"],
    priceBand: [750_000, 3_200_000],
  },
  {
    city: "Fort Lauderdale",
    zip: "33304",
    neighborhoods: ["Poinsettia Heights", "Middle River Terrace", "Lake Ridge"],
    streets: ["NE 13th Ave", "NE 16th Ter", "Flagler Dr", "NE 15th Ave", "Dixie Hwy"],
    priceBand: [480_000, 1_200_000],
  },
  {
    city: "Wilton Manors",
    zip: "33305",
    neighborhoods: ["Wilton Manors East", "Westside", "Jenada Isles"],
    streets: ["NE 26th St", "Wilton Dr", "NE 9th Ave", "NW 30th Ct", "Jenada Isle"],
    priceBand: [520_000, 1_500_000],
  },
  {
    city: "Oakland Park",
    zip: "33334",
    neighborhoods: ["Oakland Park", "North Andrews Gardens", "Coral Heights"],
    streets: ["NE 38th St", "N Andrews Ave", "NE 6th Ave", "NE 34th Ct", "NW 21st Ave"],
    priceBand: [400_000, 950_000],
  },
  {
    city: "Pompano Beach",
    zip: "33062",
    neighborhoods: ["Pompano Beach", "Santa Barbara Shores", "Harbor Village"],
    streets: ["SE 5th Ave", "N Riverside Dr", "SE 12th St", "Bay Dr", "S Ocean Blvd"],
    priceBand: [420_000, 1_800_000],
  },
  {
    city: "Hollywood",
    zip: "33019",
    neighborhoods: ["Hollywood Lakes", "Hollywood Hills", "Emerald Hills"],
    streets: ["Harrison St", "Tyler St", "N 14th Ave", "Polk St", "N Southlake Dr"],
    priceBand: [450_000, 1_600_000],
  },
];

// ---------------------------------------------------------------------------
// Agents

const AGENT_NAMES: [string, Agent["role"]][] = [
  ["Marcus Webb", "broker"],
  ["Elena Vasquez", "agent"],
  ["David Okafor", "agent"],
  ["Sofia Marchetti", "agent"],
  ["James Whitfield", "agent"],
  ["Priya Raman", "agent"],
  ["Carlos Mendoza", "agent"],
  ["Rachel Lindqvist", "agent"],
  ["Andre Baptiste", "agent"],
  ["Nina Kowalczyk", "agent"],
  ["Thomas Reyes", "agent"],
  ["Grace Delacroix", "coordinator"],
];

export const agents: Agent[] = AGENT_NAMES.map(([name, role], i) => ({
  id: `agent-${i + 1}`,
  name,
  email: `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@fortmark.com`,
  phone: `(954) 555-0${String(110 + i * 7).slice(0, 3)}`,
  role,
  licenseNo: `SL${3200000 + i * 4271}`,
}));

const sellingAgents = agents.filter((a) => a.role !== "coordinator");

// ---------------------------------------------------------------------------
// Clients

const FIRST = [
  "Michael", "Sarah", "Robert", "Jennifer", "Daniel", "Laura", "Kevin",
  "Amanda", "Brian", "Jessica", "Steven", "Melissa", "Eric", "Nicole",
  "Jonathan", "Stephanie", "Patrick", "Rebecca", "Gregory", "Christine",
  "Alejandro", "Mariana", "Victor", "Camila", "Hassan", "Yuki", "Dmitri",
  "Ingrid", "Omar", "Beatriz",
];
const LAST = [
  "Thompson", "Garcia", "Chen", "Rossi", "Kaplan", "Mitchell", "Alvarez",
  "Novak", "Sterling", "Duval", "Ferreira", "Lindstrom", "Okonkwo", "Brandt",
  "Castellanos", "Whitmore", "Nakamura", "Petrov", "Silva", "Marsh",
];

export const clients: Client[] = Array.from({ length: 44 }, (_, i) => {
  const name = `${pick(rng, FIRST)} ${pick(rng, LAST)}`;
  return {
    id: `client-${i + 1}`,
    name,
    email: `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.com`,
    phone: `(${pick(rng, ["954", "754", "305", "561"])}) 555-${String(int(rng, 1000, 9999))}`,
    type: pick(rng, ["buyer", "seller", "both"] as const),
  };
});

// ---------------------------------------------------------------------------
// Listings

const TYPES: [PropertyType, number][] = [
  ["singleFamily", 0.5],
  ["condo", 0.28],
  ["townhouse", 0.14],
  ["multiFamily", 0.06],
  ["land", 0.02],
];

function pickType(): PropertyType {
  const r = rng();
  let acc = 0;
  for (const [t, w] of TYPES) {
    acc += w;
    if (r < acc) return t;
  }
  return "singleFamily";
}

const DESCRIPTIONS = [
  "Corner lot with mature landscaping and a documented permit history. Roof replaced 2022; impact glass throughout.",
  "East-of-US1 location minutes from the beach. Split floor plan, saltwater pool, and a two-car garage.",
  "Waterfront with 75 feet of deeded dockage and ocean access, no fixed bridges. Seawall inspected 2024.",
  "Fully renovated in 2023 with permits closed. Open plan, quartz counters, and a standing-seam metal roof.",
  "Original terrazzo under carpet, solid 1958 bones, and room for a pool. Priced to the comp set.",
  "Top-floor corner unit with protected intracoastal views. Reserves fully funded; milestone inspection passed.",
  "Courtyard home in a quiet enclave. New AC 2024, whole-house generator, and accordion shutters.",
  "Double lot zoned RS-8. Survey and elevation certificate on file. Value is in the land.",
];

function folio(): string {
  return `${pick(rng, ["4942", "5042", "4943", "5142"])} ${String(int(rng, 1, 36)).padStart(2, "0")} ${String(int(rng, 1, 60)).padStart(2, "0")} ${String(int(rng, 100, 9999)).padStart(4, "0")}`;
}

function mls(): string {
  return chance(rng, 0.8) ? `F10${int(rng, 400000, 469999)}` : `A11${int(rng, 500000, 699999)}`;
}

const usedAddresses = new Set<string>();

function makeAddress(area: Area): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    const addr = `${int(rng, 200, 3900)} ${pick(rng, area.streets)}`;
    if (!usedAddresses.has(addr)) {
      usedAddresses.add(addr);
      return addr;
    }
  }
  return `${int(rng, 4000, 9900)} ${pick(rng, area.streets)}`;
}

const LISTING_STATUSES: [ListingStatus, number][] = [
  ["active", 0.42],
  ["pending", 0.1],
  ["underContract", 0.16],
  ["closed", 0.24],
  ["expired", 0.05],
  ["withdrawn", 0.03],
];

function pickListingStatus(): ListingStatus {
  const r = rng();
  let acc = 0;
  for (const [s, w] of LISTING_STATUSES) {
    acc += w;
    if (r < acc) return s;
  }
  return "active";
}

export const listings: Listing[] = Array.from({ length: 64 }, (_, i) => {
  const area = pick(rng, AREAS);
  const status = pickListingStatus();
  const propertyType = pickType();
  const base = listingPrice(rng, area.priceBand[0], area.priceBand[1]);
  const price =
    propertyType === "condo" ? Math.round(base * 0.62) : propertyType === "land" ? Math.round(base * 0.55) : base;

  // Spread listing dates across the year, denser in recent months.
  const listedDaysAgo = chance(rng, 0.55) ? int(rng, 1, 90) : int(rng, 91, 360);
  const listedDate = daysAgo(listedDaysAgo);
  const closed = status === "closed";
  const closedDaysAgo = closed ? int(rng, 0, Math.max(1, listedDaysAgo - 20)) : undefined;
  const closedDate = closedDaysAgo !== undefined ? daysAgo(closedDaysAgo) : undefined;
  const dom = closed && closedDaysAgo !== undefined ? listedDaysAgo - closedDaysAgo : listedDaysAgo;

  const priceHistory: PriceEvent[] = [
    { date: iso(listedDate), price, kind: "listed" },
  ];
  let current = price;
  if (chance(rng, 0.35) && listedDaysAgo > 30) {
    current = Math.round((price * float(rng, 0.93, 0.985)) / 5000) * 5000;
    priceHistory.push({
      date: iso(daysAgo(int(rng, closed ? (closedDaysAgo ?? 1) + 5 : 5, listedDaysAgo - 10))),
      price: current,
      kind: "reduced",
    });
  }
  const closedPrice = closed
    ? Math.round((current * float(rng, 0.94, 1.01)) / 1000) * 1000
    : undefined;
  if (closed && closedPrice && closedDate) {
    priceHistory.push({ date: iso(closedDate), price: closedPrice, kind: "closed" });
  }

  const beds = propertyType === "land" ? 0 : int(rng, 2, 6);
  return {
    id: `listing-${i + 1}`,
    mlsNumber: mls(),
    folioNumber: folio(),
    address: makeAddress(area),
    city: area.city,
    zip: area.zip,
    neighborhood: pick(rng, area.neighborhoods),
    status,
    propertyType,
    listPrice: current,
    closedPrice,
    beds,
    baths: propertyType === "land" ? 0 : Math.min(beds, int(rng, 2, 5)),
    sqft: propertyType === "land" ? 0 : int(rng, 1100, 5600),
    lotSqft: propertyType === "condo" ? undefined : int(rng, 5000, 16000),
    yearBuilt: propertyType === "condo" ? int(rng, 1970, 2024) : int(rng, 1952, 2024),
    listedDate: iso(listedDate),
    closedDate: closedDate ? iso(closedDate) : undefined,
    expiresDate:
      status === "active" || status === "pending"
        ? iso(daysAhead(int(rng, 2, 160)))
        : undefined,
    daysOnMarket: Math.max(1, dom),
    agentId: pick(rng, sellingAgents).id,
    photos: shuffle(
      rng,
      Array.from({ length: 12 }, (_, p) => `/photos/plate-${String(p + 1).padStart(2, "0")}.svg`)
    ).slice(0, 5),
    description: pick(rng, DESCRIPTIONS),
    priceHistory,
    featured: false,
  };
});

// Feature the highest-priced active listing.
const featured = [...listings]
  .filter((l) => l.status === "active")
  .sort((a, b) => b.listPrice - a.listPrice)[0];
if (featured) featured.featured = true;

// ---------------------------------------------------------------------------
// Transactions

function milestonesFor(
  contractDate: Date,
  closeDate: Date,
  stage: TransactionStage
): Milestone[] {
  const span = Math.max(20, Math.round((closeDate.getTime() - contractDate.getTime()) / DAY));
  const offsets: [MilestoneKey, number][] = [
    ["offerAccepted", 0],
    ["inspection", Math.round(span * 0.22)],
    ["appraisal", Math.round(span * 0.45)],
    ["financing", Math.round(span * 0.65)],
    ["clearToClose", Math.round(span * 0.85)],
    ["closing", span],
  ];
  const stageOrder: Record<TransactionStage, number> = {
    offer: 0,
    underContract: 1,
    inspection: 2,
    appraisal: 3,
    financing: 4,
    clearToClose: 5,
    closed: 6,
  };
  const reached = stageOrder[stage];
  return offsets.map(([key, off], idx) => {
    const date = new Date(contractDate.getTime() + off * DAY);
    let state: Milestone["state"];
    if (idx < reached || stage === "closed") state = "done";
    else state = date.getTime() < NOW.getTime() ? "overdue" : "upcoming";
    return { key, label: MILESTONE_LABELS[key], date: iso(date), state };
  });
}

const activeStages: TransactionStage[] = TRANSACTION_STAGES.filter((s) => s !== "closed");

export const transactions: Transaction[] = Array.from({ length: 34 }, (_, i) => {
  const isClosed = i >= 20; // 20 active, 14 closed across the year
  const stage: TransactionStage = isClosed ? "closed" : pick(rng, activeStages);
  const listing = pick(rng, listings);
  const client = pick(rng, clients);
  const side = chance(rng, 0.55) ? ("list" as const) : ("buy" as const);

  const contractDaysAgo = isClosed ? int(rng, 40, 350) : int(rng, 3, 55);
  const contractDate = daysAgo(contractDaysAgo);
  const escrowDays = int(rng, 30, 60);
  const closeDate = new Date(contractDate.getTime() + escrowDays * DAY);

  const contractPrice = Math.round((listing.listPrice * float(rng, 0.94, 1.03)) / 1000) * 1000;
  const milestones = milestonesFor(contractDate, closeDate, stage);
  const overdue = milestones.filter((m) => m.state === "overdue");
  const worstOverdueDays = overdue.length
    ? Math.max(...overdue.map((m) => (NOW.getTime() - new Date(m.date).getTime()) / DAY))
    : 0;
  const status = stage === "closed" ? "neutral" : worstOverdueDays > 7 ? "bad" : overdue.length ? "warn" : "good";

  return {
    id: `txn-${i + 1}`,
    listingId: listing.id,
    address: listing.address,
    city: listing.city,
    clientId: client.id,
    clientName: client.name,
    side,
    stage,
    contractPrice,
    commissionRate: pick(rng, [0.025, 0.03, 0.03, 0.035]),
    contractDate: iso(contractDate),
    closeDate: iso(closeDate),
    agentId: pick(rng, sellingAgents).id,
    milestones,
    status,
    statusLabel:
      stage === "closed" ? "Closed" : status === "bad" ? "Off track" : status === "warn" ? "At risk" : "On track",
  };
});

// ---------------------------------------------------------------------------
// Leads

const LEAD_STAGE_WEIGHTS: [LeadStage, number][] = [
  ["new", 0.2],
  ["contacted", 0.22],
  ["qualified", 0.18],
  ["touring", 0.14],
  ["negotiating", 0.08],
  ["converted", 0.1],
  ["lost", 0.08],
];

const LEAD_SOURCES: [LeadSource, number][] = [
  ["referral", 0.3],
  ["sphere", 0.22],
  ["signCall", 0.12],
  ["website", 0.16],
  ["openHouse", 0.1],
  ["pastClient", 0.1],
];

function weighted<T>(pairs: [T, number][]): T {
  const r = rng();
  let acc = 0;
  for (const [v, w] of pairs) {
    acc += w;
    if (r < acc) return v;
  }
  return pairs[0]![0];
}

const LEAD_NOTES = [
  "Pre-approved with a local lender. Wants east of US1, walkable.",
  "Selling to relocate north. Needs a close date after the school year ends.",
  "Cash buyer, second home. Comparing Coral Ridge against Las Olas Isles.",
  "Owns free and clear. Interested in a documented pricing plan before listing.",
  "First-time buyer. Budget firm; needs closing-cost guidance.",
  "1031 exchange window opens next month. Timeline is the driver.",
  "Met at the Bayview Dr open house. Wants comps for Wilton Manors.",
  "Referred by the Kaplan closing. Expects written updates weekly.",
];

export const leads: Lead[] = Array.from({ length: 52 }, (_, i) => {
  const name = `${pick(rng, FIRST)} ${pick(rng, LAST)}`;
  const createdDaysAgo = chance(rng, 0.5) ? int(rng, 0, 30) : int(rng, 31, 320);
  const lastContactDaysAgo = Math.min(createdDaysAgo, int(rng, 0, 21));
  const area = pick(rng, AREAS);
  return {
    id: `lead-${i + 1}`,
    name,
    email: `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.com`,
    phone: `(${pick(rng, ["954", "754", "305"])}) 555-${String(int(rng, 1000, 9999))}`,
    stage: weighted(LEAD_STAGE_WEIGHTS),
    source: weighted(LEAD_SOURCES),
    intent: pick(rng, ["buy", "sell", "both"] as const),
    budget: chance(rng, 0.7) ? listingPrice(rng, 450_000, 3_000_000) : undefined,
    neighborhood: chance(rng, 0.6) ? pick(rng, area.neighborhoods) : undefined,
    assignedAgentId: pick(rng, sellingAgents).id,
    createdDate: iso(daysAgo(createdDaysAgo)),
    lastContactDate: iso(daysAgo(lastContactDaysAgo)),
    notes: pick(rng, LEAD_NOTES),
  };
});

// ---------------------------------------------------------------------------
// Calendar events

const EVENT_TITLES: Record<CalendarEvent["type"], string[]> = {
  showing: ["Buyer showing", "Second showing", "Broker preview"],
  inspection: ["General inspection", "Roof inspection", "4-point inspection"],
  appraisal: ["Appraisal visit", "Appraisal walkthrough"],
  closing: ["Closing", "Final walkthrough and closing"],
  openHouse: ["Open house", "Twilight open house"],
  deadline: ["Inspection period ends", "Financing contingency ends", "Deposit due"],
};

export const events: CalendarEvent[] = Array.from({ length: 130 }, (_, i) => {
  const type = pick(rng, [
    "showing", "showing", "showing", "inspection", "appraisal",
    "closing", "openHouse", "deadline",
  ] as const);
  const dayOffset = int(rng, -35, 45);
  const start = new Date(NOW.getTime() + dayOffset * DAY);
  start.setHours(int(rng, 8, 17), pick(rng, [0, 30]), 0, 0);
  const end = new Date(start.getTime() + pick(rng, [30, 60, 90, 120]) * 60000);
  const listing = pick(rng, listings);
  const txn = chance(rng, 0.4) ? pick(rng, transactions) : undefined;
  return {
    id: `event-${i + 1}`,
    type,
    title: pick(rng, EVENT_TITLES[type]),
    address: listing.address,
    start: iso(start),
    end: iso(end),
    agentId: pick(rng, sellingAgents).id,
    transactionId: txn?.id,
    listingId: listing.id,
    notes: chance(rng, 0.3) ? "Confirmed with all parties." : undefined,
  };
});

// ---------------------------------------------------------------------------
// Documents

const DOC_NAMES: [TransactionDocument["kind"], string][] = [
  ["contract", "Purchase and sale agreement"],
  ["disclosure", "Seller's property disclosure"],
  ["disclosure", "Lead-based paint disclosure"],
  ["addendum", "Financing addendum"],
  ["addendum", "Inspection period addendum"],
  ["inspectionReport", "General inspection report"],
  ["appraisal", "Appraisal report"],
  ["closingStatement", "Closing statement"],
];

export const documents: TransactionDocument[] = transactions.flatMap((txn, t) => {
  const count = txn.stage === "closed" ? 5 : int(rng, 3, 5);
  const picks = shuffle(rng, DOC_NAMES).slice(0, count);
  return picks.map(([kind, name], d) => {
    const status =
      txn.stage === "closed"
        ? ("executed" as const)
        : weighted([
            ["executed", 0.5],
            ["pendingSignature", 0.3],
            ["missing", 0.2],
          ] as [TransactionDocument["status"], number][]);
    return {
      id: `doc-${t + 1}-${d + 1}`,
      transactionId: txn.id,
      address: txn.address,
      name,
      kind,
      status,
      updatedDate: iso(daysAgo(int(rng, 0, 40))),
      dueDate: status === "missing" ? iso(daysAhead(int(rng, 1, 10))) : undefined,
    };
  });
});

// ---------------------------------------------------------------------------
// Market activity

const HOODS = AREAS.flatMap((a) => a.neighborhoods);

const ACTIVITY: [MarketActivityItem["kind"], string, string][] = [
  ["priceReduction", "Price reduction", "List price cut on a competing property"],
  ["newComp", "New comp recorded", "Closed sale recorded within the comp radius"],
  ["demandShift", "Demand shift", "Showing volume moved against the 4-week average"],
  ["newListing", "New listing", "New inventory entered the segment"],
  ["closed", "Sale closed", "Pending sale went to record"],
];

export const marketActivity: MarketActivityItem[] = Array.from({ length: 56 }, (_, i) => {
  const [kind, title] = pick(rng, ACTIVITY);
  // First 10 items land today so the Today tab has content.
  const hoursAgo = i < 10 ? int(rng, 1, 9) : int(rng, 25, 24 * 60);
  const ts = new Date(NOW.getTime() - hoursAgo * 3600000);
  const hood = pick(rng, HOODS);
  const pct = float(rng, 1.5, 9).toFixed(1);
  const detailByKind: Record<MarketActivityItem["kind"], string> = {
    priceReduction: `${pick(rng, ["3-bed single family", "Waterfront condo", "Townhome", "4-bed pool home"])} in ${hood} reduced ${pct}%`,
    newComp: `${hood} closed at $${int(rng, 380, 760)}/sqft — ${pick(rng, ["above", "in line with", "below"])} the trailing median`,
    demandShift: `Showings in ${hood} ${pick(rng, ["up", "down"])} ${pct}% against the 4-week average`,
    newListing: `New ${pick(rng, ["single family", "condo", "townhome"])} inventory in ${hood} at $${int(rng, 400, 800)}/sqft`,
    closed: `${hood} pending sale recorded ${pct}% ${pick(rng, ["over", "under"])} ask`,
  };
  const direction = detailByKind[kind].includes("down") || kind === "priceReduction" ? "down" : chance(rng, 0.5) ? "up" : "down";
  return {
    id: `activity-${i + 1}`,
    timestamp: iso(ts),
    kind,
    title,
    detail: detailByKind[kind],
    neighborhood: hood,
    delta: chance(rng, 0.8)
      ? { value: parseFloat(pct), direction, unit: "%" }
      : undefined,
  };
});

// ---------------------------------------------------------------------------
// Compliance

export const complianceItems: ComplianceItem[] = (() => {
  const items: ComplianceItem[] = [];
  // Expiring listings within 14 days
  listings
    .filter(
      (l) =>
        l.status === "active" &&
        l.expiresDate &&
        new Date(l.expiresDate).getTime() - NOW.getTime() < 14 * DAY
    )
    .slice(0, 3)
    .forEach((l, i) =>
      items.push({
        id: `comp-exp-${i}`,
        kind: "expiringListing",
        title: `Listing agreement expires — ${l.address}`,
        detail: `${l.city} · MLS ${l.mlsNumber}`,
        dueDate: l.expiresDate!,
        severity: "warn",
        href: `/listings/${l.id}`,
      })
    );
  // Missing disclosures
  documents
    .filter((d) => d.status === "missing" && d.dueDate)
    .slice(0, 4)
    .forEach((d, i) =>
      items.push({
        id: `comp-doc-${i}`,
        kind: "missingDisclosure",
        title: `${d.name} missing — ${d.address}`,
        detail: "Required before the next milestone",
        dueDate: d.dueDate!,
        severity: "bad",
        href: `/documents?transaction=${d.transactionId}`,
      })
    );
  // Inspection deadlines this week
  transactions
    .filter((t) => t.stage !== "closed")
    .flatMap((t) =>
      t.milestones
        .filter(
          (m) =>
            m.key === "inspection" &&
            m.state !== "done" &&
            new Date(m.date).getTime() - NOW.getTime() < 7 * DAY
        )
        .map((m) => ({ t, m }))
    )
    .slice(0, 3)
    .forEach(({ t, m }, i) =>
      items.push({
        id: `comp-insp-${i}`,
        kind: "inspectionDeadline",
        title: `Inspection period ends — ${t.address}`,
        detail: `${t.clientName} · ${t.side === "list" ? "List side" : "Buy side"}`,
        dueDate: m.date,
        severity: m.state === "overdue" ? "bad" : "warn",
        href: `/transactions?open=${t.id}`,
      })
    );
  return items.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
})();

// ---------------------------------------------------------------------------
// Messages

const THREAD_SEEDS: [string, MessageThread["participantRole"], string][] = [
  ["Sarah Kaplan", "client", "Inspection scheduling for NE 26th St"],
  ["Mike Torres — Shoreline Lending", "lender", "Appraisal ordered — Isle of Venice Dr"],
  ["Jennifer Alvarez", "client", "Counteroffer terms"],
  ["Gulfstream Title", "title", "Closing package — Bayview Dr"],
  ["Robert Chen", "client", "Listing photos approval"],
  ["Coastal Inspections", "inspector", "Report delivered — Harrison St"],
  ["Amanda Sterling", "client", "Showing feedback from Saturday"],
  ["David Okafor", "agent", "Co-broke on the Wilton Dr townhome"],
  ["Laura Ferreira", "client", "Pricing plan review"],
  ["Beacon Lending", "lender", "Clear to close — SE 9th Ave"],
  ["Kevin Marsh", "client", "Escrow deposit confirmation"],
  ["Nicole Brandt", "client", "Open house on Sunday"],
];

const MSG_BODIES = [
  "Confirming Thursday at 10am works for all parties.",
  "The report is attached. Two items worth a repair credit conversation.",
  "We can hold firm at list. The comp set supports it.",
  "Signed copies received. Recording the addendum today.",
  "Buyer's lender confirmed the appraisal came in at value.",
  "Sending over the updated net sheet for your review.",
  "The seller has accepted. Moving to the inspection period.",
  "Can we move the walkthrough to 4pm the day before closing?",
];

export const messageThreads: MessageThread[] = THREAD_SEEDS.map(([name, role, subject], i) => {
  const msgCount = int(rng, 2, 6);
  const lastDaysAgo = i < 4 ? 0 : int(rng, 1, 12);
  const messages = Array.from({ length: msgCount }, (_, m) => {
    const d = new Date(
      NOW.getTime() - lastDaysAgo * DAY - (msgCount - 1 - m) * int(rng, 2, 30) * 3600000
    );
    return {
      id: `msg-${i + 1}-${m + 1}`,
      from: (m % 2 === 0 ? "them" : "me") as "them" | "me",
      body: pick(rng, MSG_BODIES),
      date: iso(d),
    };
  });
  return {
    id: `thread-${i + 1}`,
    participantName: name,
    participantRole: role,
    subject,
    lastMessageDate: messages[messages.length - 1]!.date,
    unread: i < 3,
    messages,
  };
});

// ---------------------------------------------------------------------------
// Notifications

export const notifications: AppNotification[] = [
  {
    id: "notif-1",
    title: "Inspection report delivered",
    detail: "Harrison St — two findings flagged for review",
    date: iso(new Date(NOW.getTime() - 2 * 3600000)),
    read: false,
    href: "/documents",
  },
  {
    id: "notif-2",
    title: "Offer received",
    detail: "Bayview Dr — 2% under ask, 45-day close",
    date: iso(new Date(NOW.getTime() - 5 * 3600000)),
    read: false,
    href: "/transactions",
  },
  {
    id: "notif-3",
    title: "Listing agreement expiring",
    detail: "Three listings expire within 14 days",
    date: iso(daysAgo(1)),
    read: false,
    href: "/",
  },
  {
    id: "notif-4",
    title: "Appraisal came in at value",
    detail: "Isle of Venice Dr — financing contingency next",
    date: iso(daysAgo(1)),
    read: true,
    href: "/transactions",
  },
  {
    id: "notif-5",
    title: "New lead assigned",
    detail: "Referral from the Kaplan closing",
    date: iso(daysAgo(2)),
    read: true,
    href: "/leads",
  },
  {
    id: "notif-6",
    title: "Document executed",
    detail: "Financing addendum — SE 9th Ave",
    date: iso(daysAgo(3)),
    read: true,
    href: "/documents",
  },
];

// ---------------------------------------------------------------------------
// Current user + team + brokerage (Settings)

export const currentUser = {
  id: "agent-1",
  name: "Marcus Webb",
  email: "marcus.webb@fortmark.com",
  role: "Broker" as const,
};

export const brokerage = {
  name: "FortMark",
  license: "CQ1067412",
  address: "888 E Las Olas Blvd, Suite 210, Fort Lauderdale, FL 33301",
  phone: "(954) 555-0100",
  email: "office@fortmark.com",
};
