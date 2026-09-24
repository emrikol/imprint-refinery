import { css } from "lit";

export const workflowStyles = css`
  .revision-restore-dialog { --ha-dialog-width-md: 760px; }

  .imprint-workflow-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(250px, 100%), 1fr));
    gap: 12px;
    min-width: 0;
  }

  .imprint-workflow-grid > *,
  .imprint-workflow-wide {
    min-width: 0;
    max-width: 100%;
  }

  .imprint-workflow-wide { grid-column: 1 / -1; }

  .imprint-workflow-inline-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
    min-width: 0;
  }

  .imprint-workflow-stack { display: grid; gap: 16px; min-width: 0; }

  .imprint-workflow-separator {
    width: 100%;
    margin: 4px 0;
    border: 0;
    border-top: 1px solid var(--imprint-line);
  }
`;
