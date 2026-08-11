"use client";

import { Hand, Maximize2, MousePointer2, X } from "lucide-react";
import type { RefObject } from "react";

type GestureGuideProps = {
  modalRef: RefObject<HTMLElement | null>;
  onClose: () => void;
};

export function GestureGuide({ modalRef, onClose }: GestureGuideProps) {
  return (
    <div className="modal-backdrop">
      <button
        className="modal-scrim"
        type="button"
        tabIndex={-1}
        aria-label="Close guide"
        onClick={onClose}
      />
      <section
        ref={modalRef}
        className="help-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        tabIndex={-1}
      >
        <button
          className="modal-close"
          type="button"
          onClick={onClose}
          aria-label="Close guide"
        >
          <X size={19} />
        </button>
        <span className="eyebrow">GESTURES</span>
        <h2 id="help-title">Two gestures. That’s it.</h2>
        <div className="help-grid">
          <article>
            <span>01</span>
            <Hand size={21} />
            <h3>Create</h3>
            <p>Hold an L with each hand for half a second.</p>
          </article>
          <article>
            <span>02</span>
            <MousePointer2 size={21} />
            <h3>Move</h3>
            <p>Pinch inside an area, then move your hand.</p>
          </article>
          <article>
            <span>03</span>
            <Maximize2 size={21} />
            <h3>Resize</h3>
            <p>Pinch a corner, or pinch two opposite corners.</p>
          </article>
        </div>
        <div className="fallback-note">
          <MousePointer2 size={17} />
          <p>
            Mouse and touch always work: drag to create, drag inside to move,
            and drag a corner to resize. Keyboard: C creates, 1–5 choose an
            effect, arrows move, plus or minus resizes, and Delete removes.
          </p>
        </div>
      </section>
    </div>
  );
}
