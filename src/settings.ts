/**
 * Live presentation preferences stored in the host's profile document, under
 * this plugin's entry namespace (`paper-margin` in cordis.patch.yml).
 *
 * The schema is built with the host's schemastery at runtime (require, not a
 * bundler import — the Node half resolves it from the shell's module graph),
 * so here it is only a structural face for tests and documentation.
 */
export interface MarginConfig {
  /** Send annotation batches straight into the chat; default keeps the
   * draft-only discipline. */
  directSubmit: boolean
}
