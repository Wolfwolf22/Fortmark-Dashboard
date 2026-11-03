/** Serializable configuration only: no credential or source data crosses the shell boundary. */
import "server-only";
import { calendarDatabaseEnabled, contactsDatabaseEnabled, sampleDashboardEnabled, transactionsDatabaseEnabled, type EnvLike } from "./flags";
import { listingAvailability } from "./mls/config";
import type { CreationCapabilities } from "../components/layout/creation-capabilities";
export function getCreationCapabilities(env:EnvLike=process.env):CreationCapabilities { const samples=sampleDashboardEnabled(env);return {contacts:contactsDatabaseEnabled(env),transactions:transactionsDatabaseEnabled(env),personalCalendar:calendarDatabaseEnabled(env),sampleListing:samples&&listingAvailability(env)==="sample",sampleDocument:samples}; }
