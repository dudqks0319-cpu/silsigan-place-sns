import type React from "react";
import type { CrowdLevel, FieldOption } from "./types";

const crowdLabels: Record<CrowdLevel, string> = {
  safe: "여유",
  normal: "보통",
  busy: "혼잡",
  crowded: "매우 혼잡"
};

type StatusPillProps = {
  level: CrowdLevel;
  label?: string;
};

export function StatusPill({ level, label = crowdLabels[level] }: StatusPillProps) {
  return <span className={`status-pill status-pill--${level}`}>{label}</span>;
}

type SegmentedControlProps = {
  label: string;
  value: string;
  options: FieldOption[];
  onChange: (value: string) => void;
};

export function SegmentedControl({
  label,
  value,
  options,
  onChange
}: SegmentedControlProps) {
  return (
    <fieldset className="segmented-field">
      <legend>{label}</legend>
      <div className="segmented-control">
        {options.map((option) => (
          <button
            aria-pressed={value === option.value}
            className="segment-button"
            key={option.value}
            onClick={() => onChange(option.value)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

type PrimaryButtonProps = {
  children: React.ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
};

export function ActionButton({
  children,
  onClick,
  type = "button",
  variant = "primary",
  disabled = false
}: PrimaryButtonProps) {
  return (
    <button
      className={`action-button action-button--${variant}`}
      disabled={disabled}
      onClick={onClick}
      type={type}
    >
      {children}
    </button>
  );
}
