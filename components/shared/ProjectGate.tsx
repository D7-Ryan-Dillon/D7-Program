"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Logo } from "@/components/shared/Logo";
import { GlowPanel } from "@/components/shared/GlowPanel";
import { useProject } from "@/lib/project-store";

export function ProjectGate() {
  const { enterProject, lastUsedCode } = useProject();
  const [code, setCode] = useState(lastUsedCode ?? "");

  const submit = () => {
    if (code.trim()) enterProject(code);
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <GlowPanel className="w-full max-w-sm" glow="mixed">
        <div className="flex flex-col items-center gap-6 p-8 text-center">
          <Logo />
          <div>
            <h1 className="text-lg font-medium">Enter a project code</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              A new code starts an empty project. An existing one loads everything already saved to it — on any
              device.
            </p>
          </div>
          <div className="flex w-full gap-2">
            <Input
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="e.g. workspace2026"
              className="font-mono"
            />
            <Button onClick={submit} disabled={!code.trim()}>
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
          {lastUsedCode && lastUsedCode !== code && (
            <button
              onClick={() => setCode(lastUsedCode)}
              className="font-mono text-xs text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground"
            >
              use last code on this device ({lastUsedCode})
            </button>
          )}
        </div>
      </GlowPanel>
    </div>
  );
}
