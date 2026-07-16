CREATE TABLE submissions (
    id TEXT PRIMARY KEY,
    artist TEXT NOT NULL,
    location TEXT NOT NULL DEFAULT '',
    revision TEXT NOT NULL,
    created_at TEXT NOT NULL,
    closed_at TEXT,
    winner INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE votes (
    submission_id TEXT NOT NULL,
    voter_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (submission_id, voter_id),
    FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE
);

CREATE TABLE publications (
    slot TEXT PRIMARY KEY,
    submission_id TEXT,
    published_at TEXT NOT NULL,
    FOREIGN KEY (submission_id) REFERENCES submissions(id)
);

CREATE INDEX submissions_active ON submissions(closed_at, created_at);
CREATE INDEX votes_submission ON votes(submission_id);
