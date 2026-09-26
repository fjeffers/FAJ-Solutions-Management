import type { MouseEvent } from 'react';

/**
 * Click-outside-to-close for a modal's dim backdrop, without the data loss.
 *
 * A plain `onClick={onClose}` on the backdrop fires whenever a click ENDS on
 * it — including a press that started inside the form and was released after
 * the mouse drifted a little. Picking a date or a time, or selecting text in a
 * field, does exactly that, and the form closed with everything typed in it
 * gone. Fred lost entries this way on 2026-09-25.
 *
 * This only closes when the press both started and ended on the backdrop
 * itself. Spread it onto the backdrop element:
 *
 *   <div className="modal-overlay" {...backdropClose(onClose)}>
 */
export function backdropClose(close: () => void) {
  let pressedOnBackdrop = false;
  return {
    onMouseDown: (e: MouseEvent) => {
      pressedOnBackdrop = e.target === e.currentTarget;
    },
    onClick: (e: MouseEvent) => {
      const releasedOnBackdrop = e.target === e.currentTarget;
      if (pressedOnBackdrop && releasedOnBackdrop) close();
      pressedOnBackdrop = false;
    },
  };
}
