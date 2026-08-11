-- The Instahyre source publishes the recruiter handling each posting, plus the
-- employer's own website (the listing URL is the board's, so it is useless for
-- resolving the company's email domain). Both feed the contact finder.
ALTER TABLE "JobLead"
  ADD COLUMN "recruiterName" TEXT,
  ADD COLUMN "recruiterTitle" TEXT,
  ADD COLUMN "recruiterCompany" TEXT,
  ADD COLUMN "companyUrl" TEXT;
