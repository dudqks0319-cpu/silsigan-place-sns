"use client";

import { Sparkles } from "lucide-react";
import styles from "./SilsiganRedesign.module.css";

export function EmptyState({ action, body, title }: { action?: React.ReactNode; body: string; title: string }) {
  return (
    <section className={styles.emptyState}>
      <Sparkles size={22} />
      <h2>{title}</h2>
      <p>{body}</p>
      {action}
    </section>
  );
}
