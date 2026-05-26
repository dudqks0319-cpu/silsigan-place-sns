import type { LucideIcon } from "lucide-react";

export type CrowdLevel = "safe" | "normal" | "busy" | "crowded";

export type PlaceCategory =
  | "tour"
  | "event"
  | "food"
  | "hospital"
  | "office"
  | "parking";

export type TabId = "home" | "map" | "place" | "report" | "question" | "my";

export type Place = {
  id: string;
  name: string;
  category: PlaceCategory;
  address: string;
  distance: string;
  status: string;
  summary: string;
  crowd: CrowdLevel;
  line: string;
  parking: string;
  weather: string;
  updatedAt: string;
  reports: number;
  questions: number;
  coordinates: {
    x: number;
    y: number;
  };
  photos: string[];
};

export type FieldOption = {
  label: string;
  value: string;
};

export type ReportDraft = {
  crowd: string;
  line: string;
  parking: string;
  weather: string;
  comment: string;
  hasPhoto: boolean;
  locationVerified: boolean;
};

export type QuestionDraft = {
  type: string;
  content: string;
  isPhotoRequest: boolean;
};

export type NavItem = {
  id: TabId;
  label: string;
  icon: LucideIcon;
};
