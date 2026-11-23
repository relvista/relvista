// The viewer's PDF dialog with the tile planner it needs: DbmlViewer loads this module when the
// dialog first opens, so a page that never exports a PDF does not download either.
import { useCallback, type ReactElement } from 'react';
import type { PdfOptions, PdfPageSource } from '../export/pdf/index.js';
import { contentBoxes, paddedBounds, planTiles, type TilePlan } from '../export/pdf/plan.js';
import { PdfDialog, type PdfDialogProps } from '../nav/PdfDialog.js';

export interface PdfExportProps extends Omit<PdfDialogProps, 'planFor'> {
  /** The diagram of a view as it would be printed (null when there is none). */
  pageSource(view: string): PdfPageSource | null;
}

export default function PdfExport({ pageSource, ...props }: PdfExportProps): ReactElement {
  const { current } = props;
  const planFor = useCallback(
    (o: PdfOptions, name?: string): TilePlan => {
      const src = pageSource(name ?? current);
      const b = src ? src.geometry.bounds : { x: 0, y: 0, width: 1, height: 1 };
      return planTiles(paddedBounds(b), {
        ...o,
        ...(src ? { content: contentBoxes(src.geometry) } : {}),
      });
    },
    [pageSource, current],
  );
  return <PdfDialog {...props} planFor={planFor} />;
}
