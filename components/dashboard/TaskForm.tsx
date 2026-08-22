"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const DEMO_PROMPT =
  "Analyze the fintech startup market, identify promising segments, estimate key financial metrics, and produce an investment-style report.";

export function TaskForm({ onCreated, disabled }: { onCreated: (taskId: string) => void; disabled?: boolean }) {
  const [prompt, setPrompt] = useState(DEMO_PROMPT);
  const [budget, setBudget] = useState(30);
  const [qualityThreshold, setQualityThreshold] = useState(70);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, budget, qualityThreshold }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(JSON.stringify(data.error));
        return;
      }
      onCreated(data.task.id);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">New Task</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="prompt">Task</Label>
          <Textarea id="prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="budget">Budget (tokens)</Label>
            <Input id="budget" type="number" min={1} value={budget} onChange={(e) => setBudget(Number(e.target.value))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="quality">Quality threshold</Label>
            <Input
              id="quality"
              type="number"
              min={0}
              max={100}
              value={qualityThreshold}
              onChange={(e) => setQualityThreshold(Number(e.target.value))}
            />
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button onClick={submit} disabled={disabled || submitting} className="w-full">
          {submitting ? "Launching Manager..." : "Run Task"}
        </Button>
      </CardContent>
    </Card>
  );
}
