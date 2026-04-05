import type { WritableDraft } from "immer";
import type { TemporalState } from "zundo";

import { t } from "@lingui/core/macro";
import { debounce } from "es-toolkit";
import isDeepEqual from "fast-deep-equal";
import { current } from "immer";
import { toast } from "sonner";
import { temporal } from "zundo";
import { immer } from "zustand/middleware/immer";
import { create } from "zustand/react";
import { useStoreWithEqualityFn } from "zustand/traditional";

import type { ResumeData } from "@/schema/resume/data";
import type { TailorOutput } from "@/schema/tailor";

import { orpc, type RouterOutput } from "@/integrations/orpc/client";
import { tailorOutputToPatches } from "@/utils/resume/tailor";

const STORAGE_KEY_PREFIX = "job-tailoring:";

type PersistedTailoringState = {
  jobDescription: string;
  aiSuggestions: TailorOutput | null;
  isShowingAISuggestions: boolean;
  timestamp: number;
};

function getStorageKey(resumeId: string): string {
  return `${STORAGE_KEY_PREFIX}${resumeId}`;
}

function loadTailoringState(resumeId: string): PersistedTailoringState | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(getStorageKey(resumeId));
    if (!stored) return null;
    return JSON.parse(stored) as PersistedTailoringState;
  } catch {
    return null;
  }
}

function saveTailoringState(resumeId: string, state: PersistedTailoringState): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(getStorageKey(resumeId), JSON.stringify(state));
  } catch {
    // Ignore storage errors
  }
}

function clearTailoringState(resumeId: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(getStorageKey(resumeId));
  } catch {
    // Ignore storage errors
  }
}

type Resume = Pick<RouterOutput["resume"]["getByIdForPrinter"], "id" | "name" | "slug" | "tags" | "data" | "isLocked">;

type ResumeStoreState = {
  resume: Resume;
  isReady: boolean;
  // Session-only state (not persisted to database or undo history)
  jobDescription: string;
  aiSuggestions: TailorOutput | null;
  isShowingAISuggestions: boolean;
  isGeneratingSuggestions: boolean;
};

type ResumeStoreActions = {
  initialize: (resume: Resume | null) => void;
  updateResumeData: (fn: (draft: WritableDraft<ResumeData>) => void) => void;
  // Job tailoring actions
  setJobDescription: (description: string) => void;
  setAISuggestions: (suggestions: TailorOutput | null) => void;
  setIsShowingAISuggestions: (showing: boolean) => void;
  setIsGeneratingSuggestions: (generating: boolean) => void;
  clearAISuggestions: () => void;
  applyAISuggestions: () => void;
};

type ResumeStore = ResumeStoreState & ResumeStoreActions;

const controller = new AbortController();
const signal = controller.signal;

let syncErrorToastId: string | number | undefined;

const _syncResume = async (resume: Resume) => {
  try {
    await orpc.resume.update.call({ id: resume.id, data: resume.data }, { signal });

    // Dismiss error toast on successful sync
    if (syncErrorToastId !== undefined) {
      toast.dismiss(syncErrorToastId);
      syncErrorToastId = undefined;
    }
  } catch (error: unknown) {
    // Ignore aborted requests (e.g. page navigation)
    if (error instanceof DOMException && error.name === "AbortError") return;

    syncErrorToastId = toast.error(
      t`Your latest changes could not be saved. Please make sure you are connected to the internet and try again.`,
      { id: syncErrorToastId, duration: Infinity },
    );
  }
};

const syncResume = debounce(_syncResume, 500, { signal });

// Flush pending sync before the page unloads to prevent data loss
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    syncResume.flush();
  });
}

let errorToastId: string | number | undefined;

type PartializedState = { resume: Resume | null };

export const useResumeStore = create<ResumeStore>()(
  temporal(
    immer((set, get) => ({
      resume: null as unknown as Resume,
      isReady: false,
      // Session-only state (not persisted to database)
      jobDescription: "",
      aiSuggestions: null,
      isShowingAISuggestions: false,
      isGeneratingSuggestions: false,

      initialize: (resume) => {
        set((state) => {
          state.resume = resume as Resume;
          state.isReady = resume !== null;
          
          // Load persisted tailoring state for this resume
          if (resume) {
            const persisted = loadTailoringState(resume.id);
            if (persisted) {
              state.jobDescription = persisted.jobDescription;
              state.aiSuggestions = persisted.aiSuggestions;
              state.isShowingAISuggestions = persisted.isShowingAISuggestions;
            } else {
              // Reset session-only state if no persisted data
              state.jobDescription = "";
              state.aiSuggestions = null;
              state.isShowingAISuggestions = false;
            }
          } else {
            state.jobDescription = "";
            state.aiSuggestions = null;
            state.isShowingAISuggestions = false;
          }
          state.isGeneratingSuggestions = false;
          useResumeStore.temporal.getState().clear();
        });
      },

      updateResumeData: (fn) => {
        set((state) => {
          if (!state.resume) return state;

          if (state.resume.isLocked) {
            errorToastId = toast.error(t`This resume is locked and cannot be updated.`, { id: errorToastId });
            return state;
          }

          fn(state.resume.data);
          syncResume(current(state.resume));
        });
      },

      setJobDescription: (description) => {
        set((state) => {
          state.jobDescription = description;
        });
        const { resume, jobDescription, aiSuggestions, isShowingAISuggestions } = get();
        if (resume) {
          saveTailoringState(resume.id, {
            jobDescription,
            aiSuggestions,
            isShowingAISuggestions,
            timestamp: Date.now(),
          });
        }
      },

      setAISuggestions: (suggestions) => {
        set((state) => {
          state.aiSuggestions = suggestions;
          state.isShowingAISuggestions = suggestions !== null;
        });
        const { resume, jobDescription, aiSuggestions, isShowingAISuggestions } = get();
        if (resume) {
          saveTailoringState(resume.id, {
            jobDescription,
            aiSuggestions,
            isShowingAISuggestions,
            timestamp: Date.now(),
          });
        }
      },

      setIsShowingAISuggestions: (showing) => {
        set((state) => {
          state.isShowingAISuggestions = showing && state.aiSuggestions !== null;
        });
        const { resume, jobDescription, aiSuggestions, isShowingAISuggestions } = get();
        if (resume) {
          saveTailoringState(resume.id, {
            jobDescription,
            aiSuggestions,
            isShowingAISuggestions,
            timestamp: Date.now(),
          });
        }
      },

      setIsGeneratingSuggestions: (generating) => {
        set((state) => {
          state.isGeneratingSuggestions = generating;
        });
      },

      clearAISuggestions: () => {
        set((state) => {
          state.aiSuggestions = null;
          state.isShowingAISuggestions = false;
        });
        const { resume } = get();
        if (resume) {
          clearTailoringState(resume.id);
        }
      },

      applyAISuggestions: () => {
        const { resume, aiSuggestions } = get();
        if (!resume || !aiSuggestions) return;

        // Build patch operations from AI suggestions and apply them
        const { operations } = tailorOutputToPatches(aiSuggestions, resume.data);
        if (operations.length > 0) {
          void orpc.resume.patch.call({ id: resume.id, operations });
          // Update local state
          set((state) => {
            if (!state.resume) return;
            state.aiSuggestions = null;
            state.isShowingAISuggestions = false;
          });
          clearTailoringState(resume.id);
        }
      },
    })),
    {
      partialize: (state) => ({ resume: state.resume }),
      equality: (pastState, currentState) => isDeepEqual(pastState, currentState),
      limit: 100,
    },
  ),
);

export function useTemporalStore<T>(selector: (state: TemporalState<PartializedState>) => T): T {
  return useStoreWithEqualityFn(useResumeStore.temporal, selector);
}

/**
 * Merges AI suggestions into resume data for preview purposes.
 * This creates a new ResumeData object with AI-suggested modifications applied,
 * without modifying the original resume data in the store.
 */
export function getResumeDataWithSuggestions(resumeData: ResumeData, suggestions: TailorOutput | null): ResumeData {
  if (!suggestions) return resumeData;

  // Deep clone to avoid mutations
  const merged = JSON.parse(JSON.stringify(resumeData)) as ResumeData;

  // Apply summary suggestion
  if (suggestions.summary?.content) {
    merged.summary.content = suggestions.summary.content;
  }

  // Apply experience suggestions
  for (const exp of suggestions.experiences) {
    if (exp.index >= 0 && exp.index < merged.sections.experience.items.length) {
      if (exp.description) {
        merged.sections.experience.items[exp.index].description = exp.description;
      }
      if (exp.roles) {
        for (const role of exp.roles) {
          if (role.index >= 0 && role.index < (merged.sections.experience.items[exp.index].roles?.length ?? 0)) {
            merged.sections.experience.items[exp.index].roles[role.index].description = role.description;
          }
        }
      }
    }
  }

  // Apply reference suggestions
  for (const ref of suggestions.references) {
    if (ref.index >= 0 && ref.index < merged.sections.references.items.length) {
      if (ref.description) {
        merged.sections.references.items[ref.index].description = ref.description;
      }
    }
  }

  // Apply skills suggestions - replace visible skills with curated list
  if (suggestions.skills.length > 0) {
    // Hide all existing skills
    for (const item of merged.sections.skills.items) {
      item.hidden = true;
    }

    // Add curated skills as new visible items
    for (const skill of suggestions.skills) {
      merged.sections.skills.items.push({
        id: crypto.randomUUID(),
        hidden: false,
        icon: skill.icon || "",
        name: skill.name,
        proficiency: skill.proficiency || "",
        level: 0,
        keywords: skill.keywords,
      });
    }
  }

  return merged;
}

/**
 * Hook to get the active resume data (original or AI-tailored based on toggle).
 * Use this instead of directly accessing state.resume.data for display purposes.
 */
export function useActiveResumeData(): ResumeData {
  const isShowingAISuggestions = useResumeStore((state) => state.isShowingAISuggestions);
  const aiSuggestions = useResumeStore((state) => state.aiSuggestions);
  const resumeData = useResumeStore((state) => state.resume.data);

  if (isShowingAISuggestions && aiSuggestions) {
    return getResumeDataWithSuggestions(resumeData, aiSuggestions);
  }
  return resumeData;
}

/**
 * Hook to get a specific section of the active resume data.
 * This is useful for components that only need a specific part of the resume.
 */
export function useActiveResumeSection<T>(selector: (data: ResumeData) => T): T {
  const data = useActiveResumeData();
  return selector(data);
}
