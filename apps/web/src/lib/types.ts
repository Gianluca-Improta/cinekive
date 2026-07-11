export type DominantColor = {
  hex: string;
  percentage: number;
  lab?: [number, number, number] | null;
};

export type DialogueWord = {
  word: string;
  start_ms: number;
  end_ms: number;
};

export type DialogueSegment = {
  text: string;
  start_ms: number;
  end_ms: number;
  words?: DialogueWord[];
};

export type DialoguePayload = {
  language?: string | null;
  model?: string | null;
  segments?: DialogueSegment[];
};

export type Project = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  kind: "commercial" | "social" | "archive" | "general" | "narrative" | string;
  form_factor: "long_form" | "short_form" | "mixed" | string | null;
  aspect_ratio: string | null;
  brief: string | null;
  feeling: string | null;
  references_text: string | null;
  sampling_mode: "fast" | "full" | "heroes" | "moments" | string;
  generate_previews: boolean;
  video_dir: string;
  vlm_enrichment: boolean;
  watch_folder: string | null;
  watch_enabled: boolean;
  shot_count: number;
  created_at: string;
  updated_at: string;
};

export type Shot = {
  id: string;
  project_id: string;
  source_type: "video" | "image";
  source_path: string;
  source_filename: string | null;
  source_title: string | null;
  source_meta: Record<string, unknown>;
  scene_index: number;
  start_timecode_ms: number | null;
  end_timecode_ms: number | null;
  duration_ms: number | null;
  keyframe_ms: number | null;
  source_fps: number | null;
  collection_id: string | null;
  dialogue: DialoguePayload | null;
  dialogue_text: string | null;
  width: number;
  height: number;
  dominant_colors: DominantColor[];
  has_preview: boolean;
  thumb_url: string;
  thumb_md_url: string;
  preview_url: string | null;
  keyframe_url: string;
  shot_type: string | null;
  camera_movement: string | null;
  camera_angle: string | null;
  lighting_style: string | null;
  composition: string | null;
  subject: string | null;
  lens_look: string | null;
  color_grade: string | null;
  mood_vibe: string | null;
  creative_intent: string | null;
  content_format: string | null;
  emotion: string | null;
  era: string | null;
  origin?: string | null;
  ism?: string | null;
  director?: string | null;
  visual_style: string | null;
  theme: string | null;
  genre: string | null;
  shapes: string[];
  tags: string[];
  techniques: string[];
  enrichment_version: number;
  enrichment_quality?: {
    score: number;
    pass: boolean;
    issues?: string[];
    strengths?: string[];
    needs_reenrich?: boolean;
  } | null;
  link_hints?: Record<string, string[]> | null;
  sequence_id: string | null;
  frame_role: string | null;
  hero_score: number;
  is_hero: boolean;
  is_moving: boolean;
  grade_reason: string | null;
  is_duplicate: boolean;
  notes: string | null;
  is_favorite: boolean;
  deleted_at: string | null;
  created_at: string;
};

export type Job = {
  id: string;
  project_id: string | null;
  type: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  progress_pct: number;
  current_step: string;
  total_items: number;
  processed_items: number;
  error_message: string | null;
  payload_json: Record<string, unknown>;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
};

export type SearchResult = {
  shot: Shot;
  score: number;
};

export type SearchResponse = {
  results: SearchResult[];
  total: number;
  query: string | null;
};

export type SearchFilters = {
  query?: string;
  project_id?: string;
  has_preview?: boolean;
  is_favorite?: boolean;
  is_hero?: boolean;
  is_moving?: boolean;
  hide_duplicates?: boolean;
  group_sequences?: boolean;
  tags?: string[];
  shot_type?: string;
  mood_vibe?: string;
  camera_movement?: string;
  lighting_style?: string;
  composition?: string;
  content_format?: string;
  emotion?: string;
  technique?: string;
  era?: string;
  origin?: string;
  ism?: string;
  director?: string;
  visual_style?: string;
  theme?: string;
  genre?: string;
  shape?: string;
  color_hex?: string;
  randomize?: boolean;
  limit?: number;
  offset?: number;
};

export type MoodboardResponse = {
  concepts: string[];
  results: SearchResult[];
  query_used: string;
};

export type Collection = {
  id: string;
  project_id: string | null;
  name: string;
  description: string | null;
  kind: "moodboard" | "work" | "reel" | "lookbook" | "canvas" | string;
  year: number | null;
  content_format: string | null;
  sampling_mode: string;
  cover_shot_id: string | null;
  meta: Record<string, unknown>;
  shot_count: number;
  created_at: string;
};

export type CollectionDetail = Collection & {
  shots: Shot[];
};

export type Taxonomy = {
  shot_types: string[];
  camera_movements: string[];
  camera_angles: string[];
  lighting_styles: string[];
  compositions: string[];
  lens_looks: string[];
  color_grades: string[];
  emotions: string[];
  content_formats: string[];
  eras: string[];
  origins: string[];
  isms: string[];
  visual_styles: string[];
  themes: string[];
  genres: string[];
  shapes: string[];
  techniques: string[];
  technique_groups: Record<string, string[]>;
};
