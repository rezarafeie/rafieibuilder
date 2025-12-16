
export const getThinkingSteps = (prompt: string): string[] => {
  const p = prompt.toLowerCase();
  const steps = [
    "Analyzing project requirements..."
  ];

  // Specific features
  if (p.includes("login") || p.includes("auth") || p.includes("sign in")) {
    steps.push("Planning authentication flow...");
  }
  
  if (p.includes("database") || p.includes("store") || p.includes("data")) {
    steps.push("Designing data schema...");
  }

  if (p.includes("dashboard") || p.includes("admin")) {
    steps.push("Structuring admin layout...");
    steps.push("Drafting analytics components...");
  }

  if (p.includes("landing") || p.includes("hero") || p.includes("website")) {
    steps.push("Designing responsive landing layout...");
    steps.push("Selecting typography & color palette...");
  }

  if (p.includes("shop") || p.includes("store") || p.includes("ecommerce") || p.includes("cart")) {
    steps.push("Scaffolding product catalog...");
    steps.push("Implementing shopping cart logic...");
  }

  if (p.includes("form") || p.includes("contact") || p.includes("input")) {
    steps.push("Creating form validation logic...");
  }

  // Farsi detection
  if (/[\u0600-\u06FF]/.test(p)) {
    steps.push("Configuring RTL layout support...");
    steps.push("Applying Vazirmatn typography...");
  }

  // General architecture
  steps.push("Architecting React component tree...");
  steps.push("Generating functional components & hooks...");
  steps.push("Writing Tailwind CSS styles...");
  steps.push("Finalizing code structure...");
  
  return steps;
};
