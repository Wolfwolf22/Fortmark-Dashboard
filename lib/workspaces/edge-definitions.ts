import { z } from 'zod';
// Persisted personal definitions only. Kept in sync with Competitive Edge contracts.

const name = z.string().trim().min(1).max(120);
const longitude = z.number().finite().min(-180).max(180);
const latitude = z.number().finite().min(-90).max(90);
const position = z.tuple([longitude, latitude]);
const ring = z.array(position).min(4).max(200 + 1);
const polygonCoordinates = z.array(ring).min(1).max(200 / 3);
const geometry = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Polygon'), coordinates: polygonCoordinates }).strict(),
  z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(polygonCoordinates).min(1).max(200 / 3) }).strict(),
]);


const provenance = z.object({ source: z.string().trim().min(1).max(500), version: z.string().trim().min(1).max(120), retrievedAt: z.string().datetime({ offset: true }) }).strict();
export const searchAreaSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('zips'), zips: z.array(z.string().regex(/^\d{5}$/)).min(1).max(10).transform(values => [...new Set(values)].sort()), name }).strict(),
  z.object({ type: z.literal('city'), city: z.string().trim().min(2).max(100), state: z.string().regex(/^[A-Z]{2}$/), name }).strict(),
  z.object({ type: z.literal('zip'), zip: z.string().trim().regex(/^\d{5}$/, 'Enter a five-digit ZIP code.'), name }).strict(),
  z.object({ type: z.literal('zip-section'), zip: z.string().regex(/^\d{5}$/), line: z.tuple([position,position]), side: z.enum(['left','right']), name }).strict(),
  z.object({ type: z.literal('radius'), center: position, miles: z.number().finite().min(0.1).max(10), name }).strict(),
  z.object({ type: z.literal('viewport'), bounds: z.tuple([longitude, latitude, longitude, latitude]), name }).strict(),
  z.object({ type: z.literal('polygon'), geometry, name, provenance: provenance.optional(), postalZip: z.string().regex(/^\d{5}$/).optional() }).strict(),
  z.object({ type: z.literal('neighborhood'), boundaryId: z.string().trim().min(1).max(120).regex(/^[a-zA-Z0-9_.:-]+$/), version: z.string().trim().min(1).max(120), name }).strict(),
]);

export const searchSpecSchema = z.object({
  schemaVersion: z.literal(1),
  scope: z.enum(['residential-sale', 'residential-rent', 'commercial-sale']),
  area: searchAreaSchema,
}).strict();

const farmSchema = z.object({ id: z.string().min(1).max(200), name: z.string().trim().min(1).max(80), spec: searchSpecSchema, savedAt: z.string().datetime() }).strict();
export const farmsSchema = z.array(farmSchema).max(100);

const identifier = z.string().trim().min(1).max(200);
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
});
const dateFilterSchema = z.object({
  preset: z.enum(['all', '24h', '48h', 'today', '2d', '30d', '60d', 'custom']),
  from: calendarDate.optional(), to: calendarDate.optional(),
}).strict().superRefine((value, context) => {
  if (value.preset === 'custom' && (!value.from || !value.to || value.from > value.to)) {
    context.addIssue({ code: 'custom', message: 'Choose a valid listing date range.' });
  }
});
export const workspaceCameraSchema = z.object({
  center: z.tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90)]),
  zoom: z.number().finite().min(0).max(24),
  bearing: z.number().finite().min(-360).max(360),
  pitch: z.number().finite().min(0).max(85),
}).strict();
/** Strict allowlist: a workspace contains view definitions, never feed or parcel records. */
export const savedWorkspaceViewSchema = z.object({
  spec: searchSpecSchema,
  selection: z.object({ kind: z.enum(['office', 'agent']), id: identifier }).strict().nullable(),
  comparedOfficeIds: z.array(identifier).max(3).refine(values => new Set(values).size === values.length),
  dateFilter: dateFilterSchema,
  heatMode: z.enum(['off', 'density', 'recent', 'agents']),
  camera: workspaceCameraSchema.nullable(),
  competitorMode: z.enum(['office', 'agent', 'leaders']),
  mobileView: z.enum(['map', 'list']),
  opportunitiesOpen: z.boolean(),
  comparisonOpen: z.boolean().default(false),
}).strict();
export const savedWorkspaceSchema = z.object({
  schemaVersion: z.literal(1), id: identifier, name: z.string().trim().min(1).max(80),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  view: savedWorkspaceViewSchema,
}).strict();

const targetSchema = z.object({ id:z.string().min(1).max(200),county:z.enum(['Miami-Dade','Broward']),folio:z.string().min(1).max(100),reviewed:z.boolean(),note:z.string().max(2_000) }).strict();
const parcelDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value,'Enter a valid date.');
export const campaignResultsSchema = z.object({since:parcelDate,through:parcelDate,spending:z.number().finite().min(0).max(100_000_000),leads:z.number().int().min(0).max(10_000_000),appointments:z.number().int().min(0).max(10_000_000),listingsWon:z.number().int().min(0).max(10_000_000),updatedAt:z.string().datetime()}).strict().refine(value=>value.since<=value.through,'The end date must follow the start date.');

export const campaignSchema = z.object({ id:z.string().min(1).max(100),name:z.string().trim().min(1).max(100),area:searchAreaSchema,targets:z.array(targetSchema).max(10_000),notes:z.string().max(5_000),results:campaignResultsSchema.optional(),createdAt:z.string().datetime(),updatedAt:z.string().datetime() }).strict().refine(value=>value.area.type==='polygon'&&!value.area.provenance&&!value.area.postalZip,'Campaigns require a drawn area.');

const money = z.number().finite().min(0).max(100_000_000).refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 0.00001, 'Use cents, not fractions of a cent.');
const count = z.number().int().min(0).max(10_000_000);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value);
export const farmingBudgetSchema = z.object({
  budget: money, fixedCost: money, reservePercent: z.number().finite().min(0).max(100),
  costPerTouch: money.refine(value => value > 0), targetProperties: count,
  months: z.number().int().min(1).max(36), touchesPerMonth: z.number().int().min(1).max(31),
}).strict();
export const farmingResultsSchema = z.object({
  since: date, through: date, spending: money, leads: count, appointments: count, listingsWon: count,
}).strict().refine(value => value.since <= value.through, 'The end date must follow the start date.');
export const farmingPlanSchema = z.object({schemaVersion: z.literal(1), budget: farmingBudgetSchema, results: farmingResultsSchema.nullable()}).strict();

export const ACTION_STATUSES = ['Planned', 'In progress', 'Completed'] as const;
export const ACTION_PRIORITIES = ['Standard', 'High'] as const;
export type ActionStatus = typeof ACTION_STATUSES[number];
export type ActionPriority = typeof ACTION_PRIORITIES[number];
const actionDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value);

export const campaignActionDraftSchema = z.object({
  title: z.string().trim().min(1).max(100), spec: searchSpecSchema,
  assignedTo: z.string().trim().max(120), nextAction: z.string().trim().min(1).max(300),
  dueDate: actionDate.nullable(), status: z.enum(ACTION_STATUSES), priority: z.enum(ACTION_PRIORITIES),
  notes: z.string().max(3000), parcelCampaignId: identifier.nullable(),
  farmingPlan: farmingPlanSchema.optional(),
}).strict();
export const actionSchema = campaignActionDraftSchema.extend({
  schemaVersion: z.literal(1), id: identifier, revision: z.number().int().positive(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).strict();

export const logoSchema=z.object({version:z.literal(1),entries:z.array(z.object({name:z.string().min(1).max(200),brandId:z.string().max(200).nullable(),updatedAt:z.string().datetime()}).strict()).max(500)}).strict();
export const edgeDefinitions:Record<string,z.ZodType>={
 'fm-competitive-edge:farms:v1':farmsSchema,
 'fm-competitive-edge:workspaces:v1':z.array(savedWorkspaceSchema).max(30),
 'fm-competitive-edge:parcel-campaigns:v1':z.array(campaignSchema).max(100),
 'fm-competitive-edge:campaign-actions:v1':z.array(actionSchema).max(200),
 'fm-competitive-edge:logo-corrections:v1':logoSchema,
};
