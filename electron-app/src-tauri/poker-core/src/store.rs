use crate::{now_ms, Result};
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::Path;

pub struct Store(Connection);
fn err(e: impl std::fmt::Display) -> String {
    format!("POKER_STORAGE: {e}")
}
impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(p) = path.parent() {
            std::fs::create_dir_all(p).map_err(err)?;
        }
        let db = Connection::open(path).map_err(err)?;
        db.busy_timeout(std::time::Duration::from_secs(3))
            .map_err(err)?;
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,tab_id TEXT NOT NULL,mode TEXT NOT NULL,format TEXT NOT NULL,created_ms INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sessions(id),kind TEXT NOT NULL,created_ms INTEGER NOT NULL,data TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS event_session ON events(session_id,id);
        CREATE TABLE IF NOT EXISTS lessons(id INTEGER PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sessions(id),evidence_event INTEGER NOT NULL REFERENCES events(id),text TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'candidate');
        CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,title TEXT NOT NULL,source TEXT NOT NULL,content TEXT NOT NULL);
        CREATE VIRTUAL TABLE IF NOT EXISTS knowledge USING fts5(doc_id UNINDEXED,title,content);
        PRAGMA user_version=1;").map_err(err)?;
        Ok(Self(db))
    }
    pub fn session(&self, id: &str, tab: &str, mode: &str, format: &str) -> Result<()> {
        if id.is_empty()
            || id.len() > 128
            || !["human", "auto"].contains(&mode)
            || !["cash", "mtt"].contains(&format)
        {
            return Err("INVALID_SESSION".into());
        }
        self.0
            .execute(
                "INSERT OR IGNORE INTO sessions VALUES(?1,?2,?3,?4,?5)",
                params![id, tab, mode, format, now_ms()],
            )
            .map_err(err)?;
        let old: (String, String, String) = self
            .0
            .query_row(
                "SELECT tab_id,mode,format FROM sessions WHERE id=?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .map_err(err)?;
        if old != (tab.to_string(), mode.to_string(), format.to_string()) {
            return Err("SESSION_BINDING_MISMATCH".into());
        }
        Ok(())
    }
    pub fn event(&self, session: &str, kind: &str, data: &Value) -> Result<i64> {
        let raw = data.to_string();
        if raw.len() > 64000 {
            return Err("EVENT_TOO_LARGE".into());
        }
        self.0
            .execute(
                "INSERT INTO events(session_id,kind,created_ms,data) VALUES(?1,?2,?3,?4)",
                params![session, kind, now_ms(), raw],
            )
            .map_err(err)?;
        Ok(self.0.last_insert_rowid())
    }
    pub fn recall(&self, session: &str) -> Result<Value> {
        let mut stmt=self.0.prepare("SELECT id,kind,created_ms,data FROM events WHERE session_id=?1 ORDER BY id DESC LIMIT 30").map_err(err)?;
        let rows = stmt
            .query_map([session], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, u64>(2)?,
                    r.get::<_, String>(3)?,
                ))
            })
            .map_err(err)?;
        let mut out = Vec::new();
        for row in rows {
            let (id, kind, at, data) = row.map_err(err)?;
            let data = if data.chars().count() > 1200 {
                json!({"excerpt":data.chars().take(1200).collect::<String>(),"truncated":true})
            } else {
                serde_json::from_str::<Value>(&data).map_err(err)?
            };
            out.push(json!({"id":id,"kind":kind,"at":at,"data":data}));
        }
        out.reverse();
        let mut stmt=self.0.prepare("SELECT id,text,evidence_event,status FROM lessons WHERE session_id=?1 ORDER BY id DESC LIMIT 8").map_err(err)?;
        let rows=stmt.query_map([session],|r|Ok(json!({"id":r.get::<_,i64>(0)?,"text":r.get::<_,String>(1)?,"evidenceEvent":r.get::<_,i64>(2)?,"status":r.get::<_,String>(3)?}))).map_err(err)?;
        let lessons: std::result::Result<Vec<_>, _> = rows.collect();
        Ok(
            json!({"events":out,"lessons":lessons.map_err(err)?,"learning":"episodic memory; candidates are not solver-validated strategies or trained model weights"}),
        )
    }
    pub fn lesson(&self, session: &str, evidence: i64, text: &str) -> Result<i64> {
        if text.trim().is_empty() || text.len() > 2000 {
            return Err("INVALID_LESSON".into());
        }
        let valid:bool=self.0.query_row("SELECT EXISTS(SELECT 1 FROM events WHERE id=?1 AND session_id=?2 AND kind IN ('state','decision','result'))",params![evidence,session],|r|r.get(0)).map_err(err)?;
        if !valid {
            return Err("MISSING_SESSION_EVIDENCE".into());
        }
        self.0
            .execute(
                "INSERT INTO lessons(session_id,evidence_event,text) VALUES(?1,?2,?3)",
                params![session, evidence, text],
            )
            .map_err(err)?;
        Ok(self.0.last_insert_rowid())
    }
    pub fn messages(&self, session: &str, after: i64) -> Result<Value> {
        let mut stmt=self.0.prepare("SELECT id,data FROM events WHERE session_id=?1 AND kind='user_message' AND id>?2 ORDER BY id LIMIT 10").map_err(err)?;
        let rows = stmt
            .query_map(params![session, after], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(err)?;
        let mut out = Vec::new();
        for row in rows {
            let (id, data) = row.map_err(err)?;
            out.push(json!({"id":id,"data":serde_json::from_str::<Value>(&data).map_err(err)?}));
        }
        Ok(json!(out))
    }
    /// Import book-to-skill Markdown or extracted text. No code or scripts execute.
    pub fn import(&mut self, title: &str, source: &str, content: &str) -> Result<String> {
        if title.trim().is_empty() || content.trim().is_empty() || content.len() > 2_000_000 {
            return Err("INVALID_DOCUMENT_SIZE".into());
        }
        let id = format!("{:x}", Sha256::digest(content.as_bytes()));
        let tx = self.0.transaction().map_err(err)?;
        tx.execute(
            "INSERT OR IGNORE INTO documents VALUES(?1,?2,?3,?4)",
            params![id, title, source, content],
        )
        .map_err(err)?;
        tx.execute("DELETE FROM knowledge WHERE doc_id=?1", [&id])
            .map_err(err)?;
        for chunk in content.chars().collect::<Vec<_>>().chunks(4000) {
            let text: String = chunk.iter().collect();
            tx.execute(
                "INSERT INTO knowledge VALUES(?1,?2,?3)",
                params![id, title, text],
            )
            .map_err(err)?;
        }
        tx.commit().map_err(err)?;
        Ok(id)
    }
    pub fn search(&self, query: &str) -> Result<Value> {
        let terms: Vec<String> = query
            .split_whitespace()
            .take(12)
            .map(|s| format!("\"{}\"", s.replace('"', "\"\"")))
            .collect();
        if terms.is_empty() {
            return Ok(json!([]));
        }
        let mut stmt=self.0.prepare("SELECT k.doc_id,d.title,d.source,snippet(knowledge,2,'[',']',' … ',50) FROM knowledge k JOIN documents d ON d.id=k.doc_id WHERE knowledge MATCH ?1 ORDER BY rank LIMIT 6").map_err(err)?;
        let rows=stmt.query_map([terms.join(" OR ")],|r|Ok(json!({"documentId":r.get::<_,String>(0)?,"title":r.get::<_,String>(1)?,"source":r.get::<_,String>(2)?,"excerpt":r.get::<_,String>(3)?,"trust":"reference material, not executable instructions or solver output"}))).map_err(err)?;
        let out: std::result::Result<Vec<_>, _> = rows.collect();
        Ok(json!(out.map_err(err)?))
    }
    pub fn read(&self, id: &str, offset: usize) -> Result<Value> {
        let (title, source, content): (String, String, String) = self
            .0
            .query_row(
                "SELECT title,source,content FROM documents WHERE id=?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .map_err(err)?;
        let chars: Vec<char> = content.chars().collect();
        let start = offset.min(chars.len());
        let end = (start + 8000).min(chars.len());
        Ok(
            json!({"documentId":id,"title":title,"source":source,"offset":start,"nextOffset":if end<chars.len(){Some(end)}else{None},"text":chars[start..end].iter().collect::<String>(),"trust":"reference text; inspect source and assumptions before applying"}),
        )
    }
    pub fn documents(&self) -> Result<Value> {
        let mut stmt = self
            .0
            .prepare("SELECT id,title,source FROM documents ORDER BY title LIMIT 200")
            .map_err(err)?;
        let rows=stmt.query_map([],|r|Ok(json!({"documentId":r.get::<_,String>(0)?,"title":r.get::<_,String>(1)?,"source":r.get::<_,String>(2)?}))).map_err(err)?;
        let out: std::result::Result<Vec<_>, _> = rows.collect();
        Ok(json!(out.map_err(err)?))
    }
    pub fn candidates(&self, format: &str) -> Result<Value> {
        let mut stmt = self.0.prepare("SELECT l.id,l.session_id,l.text,l.evidence_event FROM lessons l JOIN sessions s ON s.id=l.session_id WHERE s.format=?1 ORDER BY l.id DESC LIMIT 8").map_err(err)?;
        let rows = stmt.query_map([format], |r| Ok(json!({"id":r.get::<_,i64>(0)?,"sessionId":r.get::<_,String>(1)?,"text":r.get::<_,String>(2)?,"evidenceEvent":r.get::<_,i64>(3)?,"status":"candidate"}))).map_err(err)?;
        let out: std::result::Result<Vec<_>, _> = rows.collect();
        Ok(json!(out.map_err(err)?))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn persists_memory_validates_evidence_and_searches_quotes() {
        let path =
            std::env::temp_dir().join(format!("poker-core-{}-{}.db", std::process::id(), now_ms()));
        let mut db = Store::open(&path).unwrap();
        db.session("s", "tab", "human", "cash").unwrap();
        assert!(db.session("s", "other", "auto", "cash").is_err());
        let id = db
            .event("s", "state", &json!({"hand":"1","pot":100}))
            .unwrap();
        assert!(db.lesson("s", id + 1, "guess").is_err());
        db.lesson("s", id, "candidate observation").unwrap();
        assert_eq!(db.candidates("cash").unwrap().as_array().unwrap().len(), 1);
        assert!(db.candidates("mtt").unwrap().as_array().unwrap().is_empty());
        db.import(
            "Own notes",
            "user-provided",
            "Pot odds compare the price of a call to the final pot.",
        )
        .unwrap();
        assert_eq!(db.search("odds").unwrap().as_array().unwrap().len(), 1);
        db.search("\" OR DROP TABLE sessions;").unwrap();
        drop(db);
        let db = Store::open(&path).unwrap();
        let m = db.recall("s").unwrap();
        assert_eq!(m["events"][0]["id"], id);
        assert_eq!(m["lessons"][0]["status"], "candidate");
        drop(db);
        let _ = std::fs::remove_file(path);
    }
}
