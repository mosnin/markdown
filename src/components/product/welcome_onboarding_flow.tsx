"use client";

import Image from "next/image";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { ArrowRight, Building2, Circle, Gauge, Palette, PenTool, UserRound, Wrench } from "lucide-react";
import BackgroundSnippetsNoiseEffect11 from "@/components/ui/background-snippets-noise-effect11";
import { completeWelcomeOnboardingAction } from "@/app/welcome/actions";

type ThemeChoice = "light" | "dark";

const sizeOptions = [
  { id: "solo", label: "Solo", icon: Circle },
  { id: "2-20", label: "2 - 20", icon: Circle },
  { id: "21-200", label: "21 - 200", icon: Circle },
  { id: "200+", label: "200+", icon: Circle },
] as const;

const roleOptions = [
  { id: "founder", label: "Founder", icon: Building2 },
  { id: "product", label: "Product", icon: Palette },
  { id: "designer", label: "Designer", icon: PenTool },
  { id: "engineer", label: "Engineer", icon: Wrench },
  { id: "consultant", label: "Consultant", icon: Gauge },
  { id: "marketing-sales", label: "Marketing / Sales", icon: Circle },
  { id: "operations", label: "Operations", icon: Gauge },
  { id: "other", label: "Other", icon: UserRound },
] as const;

export function WelcomeOnboardingFlow({
  initialFullName,
  initialTheme,
}: {
  initialFullName: string;
  initialTheme: ThemeChoice;
}) {
  const router = useRouter();
  const { setTheme } = useTheme();
  const [step, setStep] = useState(0);
  const [pending, startTransition] = useTransition();
  const [themeChoice, setThemeChoice] = useState<ThemeChoice>(initialTheme);
  const [companySize, setCompanySize] = useState<string>("solo");
  const [role, setRole] = useState<string>("founder");
  const [fullName, setFullName] = useState(initialFullName);
  const [error, setError] = useState<string | null>(null);

  const canContinue = useMemo(() => {
    if (step === 0) return !!themeChoice;
    if (step === 1) return !!companySize;
    if (step === 2) return !!role;
    if (step === 3) return fullName.trim().length >= 2;
    return true;
  }, [step, themeChoice, companySize, role, fullName]);

  function goNext() {
    if (!canContinue || pending) return;

    if (step === 0) {
      setTheme(themeChoice);
      setStep(1);
      return;
    }
    if (step < 3) {
      setStep((s) => s + 1);
      return;
    }

    startTransition(async () => {
      setTheme(themeChoice);
      const res = await completeWelcomeOnboardingAction({
        fullName,
        role,
        companySize,
        theme: themeChoice,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.replace("/app");
    });
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-12">
      <BackgroundSnippetsNoiseEffect11 />
      <div className="relative z-10 w-full max-w-3xl rounded-2xl border border-border/40 bg-background/70 p-8 backdrop-blur-md">
        <div className="mb-6 flex justify-center">
          <Image src="/logo-symbol-light.png" alt="Poggle" width={42} height={42} className="rounded" />
        </div>

        {step === 0 && (
          <section className="space-y-6 text-center">
            <h1 className="text-4xl font-bold tracking-tight text-foreground">Pick your style</h1>
            <div className="grid grid-cols-2 gap-4">
              {(["light", "dark"] as const).map((choice) => (
                <button
                  key={choice}
                  type="button"
                  onClick={() => setThemeChoice(choice)}
                  className={`rounded-xl border p-6 text-left transition ${
                    themeChoice === choice ? "border-yellow-400 bg-yellow-400/10" : "border-border bg-card/60"
                  }`}
                >
                  <p className="text-sm font-semibold capitalize">{choice}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {choice === "light" ? "Bright workspace" : "Low-glare workspace"}
                  </p>
                </button>
              ))}
            </div>
          </section>
        )}

        {step === 1 && (
          <section className="space-y-6 text-center">
            <h1 className="text-4xl font-bold tracking-tight text-foreground">How many people work at your company?</h1>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {sizeOptions.map((option) => {
                const Icon = option.icon;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setCompanySize(option.id)}
                    className={`rounded-xl border p-4 transition ${
                      companySize === option.id ? "border-yellow-400 bg-yellow-400/10" : "border-border bg-card/60"
                    }`}
                  >
                    <Icon className="mx-auto h-5 w-5" />
                    <p className="mt-2 text-sm font-medium">{option.label}</p>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="space-y-6 text-center">
            <h1 className="text-4xl font-bold tracking-tight text-foreground">Which role fits you best?</h1>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {roleOptions.map((option) => {
                const Icon = option.icon;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setRole(option.id)}
                    className={`rounded-xl border p-4 transition ${
                      role === option.id ? "border-yellow-400 bg-yellow-400/10" : "border-border bg-card/60"
                    }`}
                  >
                    <Icon className="mx-auto h-5 w-5" />
                    <p className="mt-2 text-sm font-medium">{option.label}</p>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {step === 3 && (
          <section className="space-y-6">
            <h1 className="text-center text-4xl font-bold tracking-tight text-foreground">What&apos;s your name?</h1>
            <div className="mx-auto max-w-md">
              <label className="mb-2 block text-sm text-muted-foreground">Full name</label>
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full rounded-xl border border-border bg-background/80 px-4 py-3 text-sm outline-none ring-yellow-400/60 focus:ring-2"
                placeholder="Your name"
              />
            </div>
          </section>
        )}

        {error && <p className="mt-4 text-center text-sm text-destructive">{error}</p>}

        <div className="mt-8 flex flex-col items-center gap-5">
          <button
            type="button"
            onClick={goNext}
            disabled={!canContinue || pending}
            className="inline-flex items-center gap-2 rounded-full bg-foreground px-8 py-3 text-sm font-medium text-background disabled:opacity-50"
          >
            {step === 3 ? (pending ? "Finishing…" : "Finish") : "Next"}
            <ArrowRight className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2">
            {[0, 1, 2, 3].map((idx) => (
              <span
                key={idx}
                className={`h-2 rounded-full transition-all ${idx === step ? "w-6 bg-foreground" : "w-2 bg-foreground/30"}`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
