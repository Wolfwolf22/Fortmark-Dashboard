/** A deal a contact is on, as the drawer's compact Transactions section shows it. */
export interface LinkedTransaction {
  id: string;
  address: string;
  city: string;
  /** The transaction stage value; the screen supplies the label. */
  stage: string;
  /** Operational files can name their setup state without exposing an internal sales placeholder. */
  workflowLabel?: string;
}
