export const owner = {
  name: process.env.OWNER_NAME ?? "Varun Chandwani",
  email: process.env.OWNER_EMAIL ?? "varunchandwani101@gmail.com",
  phone: process.env.OWNER_PHONE ?? "+91 8407968503",
  github: process.env.OWNER_GITHUB ?? "https://github.com/varun-101",
  githubHandle: "varun-101",
  linkedin: process.env.OWNER_LINKEDIN ?? "https://www.linkedin.com/in/varun-chandwani",
  linkedinHandle: "Varun Chandwani",
  portfolio: process.env.OWNER_PORTFOLIO ?? "https://www.varun101.dev",
  city: process.env.OWNER_CITY ?? "Mumbai",
  country: process.env.OWNER_COUNTRY ?? "India",
  yearsOfExperience: process.env.OWNER_YOE ?? "1",
  education: {
    degree: "Computer Engineering",
    school: "Thadomal Shahani Engineering College",
    cgpa: "8",
    grad: "Apr 2026",
  },
  experience: [
    {
      title: "Backend Software Engineer Intern",
      company: "Loan for India",
      period: "June 2025 – November 2025",
      bullets: [
        "Built full-scale backend infrastructure to manage home loans for customers across Mumbai as one of two backend engineers.",
        "Collaborated with internal teams and external banking partners (HDFC, SBI) to automate loan approvals on behalf of partner banks.",
        "Designed PostgreSQL schemas and Java services to streamline end-to-end loan processing.",
      ],
    },
  ],
  extras: [
    {
      title: "SMM Head",
      org: "IETE – TSEC",
      period: "July 2024 – present",
      summary: "Lead a team of five managing event and marketing social media; oversee scheduling, creation, and execution of posts to drive engagement.",
    },
  ],
};
