import { Trans } from "@lingui/react/macro";
import {
  ArrowCounterClockwiseIcon,
  BrainIcon,
  CheckCircleIcon,
  MagicWandIcon,
  SparkleIcon,
  WarningIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { useResumeStore } from "@/components/resume/store/resume";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAIStore } from "@/integrations/ai/store";
import { orpc } from "@/integrations/orpc/client";
import { type JobResult } from "@/schema/jobs";

import { SectionBase } from "../shared/section-base";

export function JobTailoringSectionBuilder() {
  const jobDescription = useResumeStore((state) => state.jobDescription);
  const aiSuggestions = useResumeStore((state) => state.aiSuggestions);
  const isShowingAISuggestions = useResumeStore((state) => state.isShowingAISuggestions);
  const setJobDescription = useResumeStore((state) => state.setJobDescription);
  const setAISuggestions = useResumeStore((state) => state.setAISuggestions);
  const setIsShowingAISuggestions = useResumeStore((state) => state.setIsShowingAISuggestions);
  const setIsGeneratingSuggestions = useResumeStore((state) => state.setIsGeneratingSuggestions);
  const clearAISuggestions = useResumeStore((state) => state.clearAISuggestions);
  const applyAISuggestions = useResumeStore((state) => state.applyAISuggestions);
  const resumeData = useResumeStore((state) => state.resume.data);

  const aiEnabled = useAIStore((state) => state.enabled);
  const aiProvider = useAIStore((state) => state.provider);
  const aiModel = useAIStore((state) => state.model);
  const aiApiKey = useAIStore((state) => state.apiKey);
  const aiBaseURL = useAIStore((state) => state.baseURL);

  const [showConfirmation, setShowConfirmation] = useState(false);

  const { mutate: generateSuggestions, isPending: isGenerating } = useMutation({
    mutationFn: async () => {
      if (!jobDescription.trim()) {
        throw new Error("Please enter a job description");
      }

      setIsGeneratingSuggestions(true);

      try {
        // Create a minimal JobResult from the job description
        const job: JobResult = {
          job_id: `manual-${Date.now()}`,
          job_title: "Custom Job",
          employer_name: "Custom Company",
          employer_logo: null,
          employer_website: null,
          employer_company_type: null,
          employer_linkedin: null,
          job_publisher: "",
          job_employment_type: "",
          job_apply_link: "",
          job_apply_is_direct: false,
          job_apply_quality_score: null,
          job_description: jobDescription,
          job_is_remote: false,
          job_city: "",
          job_state: "",
          job_country: "",
          job_latitude: null,
          job_longitude: null,
          job_posted_at_timestamp: null,
          job_posted_at_datetime_utc: "",
          job_offer_expiration_datetime_utc: null,
          job_offer_expiration_timestamp: null,
          job_min_salary: null,
          job_max_salary: null,
          job_salary_currency: null,
          job_salary_period: null,
          job_benefits: null,
          job_google_link: null,
          job_required_experience: {
            no_experience_required: false,
            required_experience_in_months: null,
            experience_mentioned: false,
            experience_preferred: false,
          },
          job_required_skills: null,
          job_required_education: {
            postgraduate_degree: false,
            professional_certification: false,
            high_school: false,
            associates_degree: false,
            bachelors_degree: false,
            degree_mentioned: false,
            degree_preferred: false,
            professional_certification_mentioned: false,
          },
          job_experience_in_place_of_education: null,
          job_highlights: null,
          job_posting_language: null,
          job_onet_soc: null,
          job_onet_job_zone: null,
          job_occupational_categories: null,
          job_naics_code: null,
          job_naics_name: null,
          apply_options: [],
        };

        const result = await orpc.ai.tailorResume.call({
          provider: aiProvider,
          model: aiModel,
          apiKey: aiApiKey,
          baseURL: aiBaseURL,
          resumeData,
          job,
        });

        return result;
      } finally {
        setIsGeneratingSuggestions(false);
      }
    },
    onSuccess: (data) => {
      setAISuggestions(data);
      toast.success("AI suggestions generated successfully");
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Failed to generate suggestions";
      toast.error(message);
    },
  });

  const handleGenerate = () => {
    generateSuggestions();
  };

  const handleToggleSuggestions = (checked: boolean) => {
    setIsShowingAISuggestions(checked);
  };

  const handleDiscard = () => {
    clearAISuggestions();
    setShowConfirmation(false);
    toast.info("AI suggestions discarded");
  };

  const handleApply = () => {
    applyAISuggestions();
    setShowConfirmation(false);
    toast.success("AI suggestions applied to your resume");
  };

  return (
    <SectionBase type="job-tailoring">
      <div className="space-y-4">
        {/* AI Status */}
        <div className="flex items-center gap-x-2 rounded-md border bg-muted/50 p-3">
          {aiEnabled ? (
            <>
              <CheckCircleIcon className="size-4 text-success" />
              <span className="text-sm">
                <Trans>AI is enabled</Trans>
              </span>
            </>
          ) : (
            <>
              <WarningIcon className="text-warning size-4" />
              <span className="text-sm">
                <Trans>AI is not configured</Trans>
              </span>
            </>
          )}
        </div>

        {/* Job Description Input */}
        <div className="space-y-2">
          <Label htmlFor="job-description">
            <Trans>Job Description</Trans>
          </Label>
          <Textarea
            id="job-description"
            placeholder="Paste the job description here..."
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            disabled={isGenerating || isShowingAISuggestions}
            className="min-h-[120px] resize-y"
          />
        </div>

        {/* Generate Button */}
        <Button
          onClick={handleGenerate}
          disabled={!aiEnabled || isGenerating || !jobDescription.trim() || isShowingAISuggestions}
          className="w-full"
        >
          {isGenerating ? (
            <>
              <Spinner className="mr-2 size-4" />
              <Trans>Generating...</Trans>
            </>
          ) : (
            <>
              <SparkleIcon className="mr-2 size-4" />
              <Trans>Generate AI Suggestions</Trans>
            </>
          )}
        </Button>

        {/* Suggestions Toggle */}
        {aiSuggestions && (
          <>
            <Separator />

            <div className="space-y-4 rounded-md border bg-muted/30 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-x-2">
                  <BrainIcon className="size-5 text-primary" />
                  <span className="font-medium">
                    <Trans>AI Suggestions</Trans>
                  </span>
                </div>
                <Switch checked={isShowingAISuggestions} onCheckedChange={handleToggleSuggestions} />
              </div>

              <div className="bg-info/10 border-info/20 flex items-center gap-x-2 rounded-md border px-3 py-2 text-sm text-info">
                <CheckCircleIcon className="size-4 shrink-0" />
                <Trans>Suggestions restored from previous session</Trans>
              </div>

              <p className="text-sm text-muted-foreground">
                {isShowingAISuggestions ? (
                  <Trans>Viewing AI-optimized version of your resume</Trans>
                ) : (
                  <Trans>Toggle to see AI-optimized version</Trans>
                )}
              </p>

              {/* Summary of Changes */}
              <div className="space-y-2 text-sm">
                {aiSuggestions.summary && (
                  <div className="flex items-center gap-x-2 text-muted-foreground">
                    <CheckCircleIcon className="size-3.5" />
                    <span>
                      <Trans>Summary optimized</Trans>
                    </span>
                  </div>
                )}
                {aiSuggestions.experiences && aiSuggestions.experiences.length > 0 && (
                  <div className="flex items-center gap-x-2 text-muted-foreground">
                    <CheckCircleIcon className="size-3.5" />
                    <span>
                      <Trans>{aiSuggestions.experiences.length} experience entries tailored</Trans>
                    </span>
                  </div>
                )}
                {aiSuggestions.skills && aiSuggestions.skills.length > 0 && (
                  <div className="flex items-center gap-x-2 text-muted-foreground">
                    <CheckCircleIcon className="size-3.5" />
                    <span>
                      <Trans>{aiSuggestions.skills.length} skills curated</Trans>
                    </span>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              {!showConfirmation ? (
                <div className="flex gap-x-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => setShowConfirmation(true)}>
                    <MagicWandIcon className="mr-1.5 size-3.5" />
                    <Trans>Apply</Trans>
                  </Button>
                  <Button variant="outline" size="sm" className="flex-1" onClick={handleDiscard}>
                    <XCircleIcon className="mr-1.5 size-3.5" />
                    <Trans>Discard</Trans>
                  </Button>
                </div>
              ) : (
                <div className="bg-warning/10 border-warning/20 space-y-3 rounded-md border p-3">
                  <p className="text-sm">
                    <Trans>Are you sure? This will permanently modify your resume.</Trans>
                  </p>
                  <div className="flex gap-x-2">
                    <Button size="sm" className="flex-1" onClick={handleApply}>
                      <CheckCircleIcon className="mr-1.5 size-3.5" />
                      <Trans>Yes, Apply</Trans>
                    </Button>
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => setShowConfirmation(false)}>
                      <ArrowCounterClockwiseIcon className="mr-1.5 size-3.5" />
                      <Trans>Cancel</Trans>
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </SectionBase>
  );
}
