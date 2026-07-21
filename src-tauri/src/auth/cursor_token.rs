use crate::auth::{AuthError, CursorCredentials};
use dirs::home_dir;
use rusqlite::{Connection, OpenFlags};
use std::path::PathBuf;

const ACCESS_TOKEN_KEY: &str = "cursorAuth/accessToken";
const EMAIL_KEY: &str = "cursorAuth/cachedEmail";
const MEMBERSHIP_KEY: &str = "cursorAuth/stripeMembershipType";

fn candidate_db_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Some(home) = home_dir() {
        paths.push(
            home.join("Library/Application Support/Cursor/User/globalStorage/state.vscdb"),
        );
        paths.push(
            home.join(
                "Library/Application Support/Cursor - Insiders/User/globalStorage/state.vscdb",
            ),
        );
    }
    paths
}

fn read_item(conn: &Connection, key: &str) -> Result<Option<String>, AuthError> {
    let mut stmt = conn
        .prepare("SELECT value FROM ItemTable WHERE key = ?1")
        .map_err(|e| AuthError::Database(e.to_string()))?;

    let mut rows = stmt
        .query([key])
        .map_err(|e| AuthError::Database(e.to_string()))?;

    match rows.next() {
        Ok(Some(row)) => {
            let value: String = row
                .get(0)
                .map_err(|e| AuthError::Database(e.to_string()))?;
            if value.is_empty() {
                Ok(None)
            } else {
                Ok(Some(value))
            }
        }
        Ok(None) => Ok(None),
        Err(e) => Err(AuthError::Database(e.to_string())),
    }
}

pub fn read_local_credentials() -> Result<CursorCredentials, AuthError> {
    let db_path = candidate_db_paths()
        .into_iter()
        .find(|path| path.exists())
        .ok_or(AuthError::DatabaseNotFound)?;

    let conn = Connection::open_with_flags(
        &db_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| AuthError::Database(e.to_string()))?;

    let access_token = read_item(&conn, ACCESS_TOKEN_KEY)?.ok_or(AuthError::TokenNotFound)?;
    let email = read_item(&conn, EMAIL_KEY)?;
    let membership_type = read_item(&conn, MEMBERSHIP_KEY)?;

    Ok(CursorCredentials {
        access_token,
        email,
        membership_type,
    })
}
