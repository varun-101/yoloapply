// Clerk prebuilt-component theming matched to the Night Shift palette
// (tailwind.config.ts ink scale + signal amber). Used by <ClerkProvider>.
export const clerkAppearance = {
  variables: {
    colorPrimary: "#FFB224",
    colorBackground: "#161C30", // slate-900 ink
    colorInputBackground: "#0B0F1E", // slate-950 ink
    colorInputText: "#E9EDF6", // slate-100
    colorText: "#E9EDF6",
    colorTextSecondary: "#8693B6", // slate-400
    colorNeutral: "#E9EDF6",
    colorDanger: "#ef4444",
    borderRadius: "0.5rem",
    fontFamily: "var(--font-sans), system-ui, sans-serif",
  },
  elements: {
    formButtonPrimary:
      "bg-[#FFB224] text-[#0B0F1E] hover:bg-[#ffc14d] font-semibold normal-case",
    card: "border border-[#333C58] shadow-2xl",
    headerTitle: "font-[var(--font-display)]",
    footerActionLink: "text-[#FFB224] hover:text-[#ffc14d]",
  },
} as const;
