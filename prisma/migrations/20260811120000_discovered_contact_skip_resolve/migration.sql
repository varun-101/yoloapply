-- An agency recruiter named on a job listing is a real contact for that role,
-- but they do not work at the employer whose domain the cache is keyed by.
-- Persisting the flag is what stops "Reveal & select" from asking a provider for
-- "<their name> @ <employer domain>" and materializing a different real person.
ALTER TABLE "DiscoveredContact" ADD COLUMN "skipResolve" BOOLEAN NOT NULL DEFAULT false;
