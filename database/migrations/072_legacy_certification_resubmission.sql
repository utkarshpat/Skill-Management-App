-- Historical pending/approved records stay readable and reviewable. A returned
-- legacy credential must use the current linked submission policy when resubmitted.
CREATE OR ALTER TRIGGER dbo.CertificationRelatedSkillRequired ON dbo.CertificationRecord AFTER INSERT,UPDATE AS BEGIN
 SET NOCOUNT ON;
 IF EXISTS(SELECT 1 FROM inserted c WHERE c.requires_skill_link=1 AND c.status IN('SUBMITTED','APPROVED') AND NOT EXISTS(SELECT 1 FROM dbo.SkillCertificationLink l JOIN dbo.SkillClaimDraft s ON s.account_id=l.account_id AND s.claim_id=l.claim_id WHERE l.account_id=c.account_id AND l.certification_id=c.id AND s.person_id=c.person_id)) THROW 51012,'Link the certification to an owned skill before submitting.',1;
 IF EXISTS(SELECT 1 FROM inserted c LEFT JOIN deleted d ON d.account_id=c.account_id AND d.id=c.id WHERE c.status='SUBMITTED' AND (d.id IS NULL OR d.status<>'SUBMITTED') AND NOT EXISTS(SELECT 1 FROM dbo.CapabilitySubmissionItem i JOIN dbo.CapabilitySubmission b ON b.account_id=i.account_id AND b.id=i.submission_id WHERE i.account_id=c.account_id AND i.kind='CERTIFICATION' AND i.record_id=c.id AND i.needs_review=1 AND b.person_id=c.person_id AND b.status='SUBMITTING')) THROW 51012,'Submit linked credentials through their combined request.',1;
END;
GO
