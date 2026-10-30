//! Policy for the public WebView proxy. Internal native configuration requests bypass this module.
use serde_json::{json, Value};

pub(super) fn validate(
    method: &str,
    path: &str,
    body: Option<&str>,
    managed: bool,
) -> Result<(), String> {
    let denied = || "该同步操作不允许通过通用代理执行，请使用专用确认流程。".to_string();
    if body.is_some() {
        return Err(denied());
    }
    let (endpoint, query) = path.split_once('?').unwrap_or((path, ""));
    let query_keys: &[&str] = match (method, endpoint) {
        (
            "GET",
            "/rest/system/status"
            | "/rest/config/folders"
            | "/rest/config/devices"
            | "/rest/system/connections"
            | "/rest/config/defaults/folder"
            | "/rest/config/defaults/device"
            | "/rest/config/restart-required",
        ) => &[],
        ("GET", "/rest/db/status") | ("POST", "/rest/db/scan") => &["folder"],
        ("GET", "/rest/db/completion") => &["folder", "device"],
        _ => return Err(denied()),
    };
    let parameters: Vec<_> = if query.is_empty() {
        vec![]
    } else {
        query.split('&').collect()
    };
    if parameters.len() != query_keys.len() {
        return Err(denied());
    }
    for key in query_keys {
        let values: Vec<_> = parameters
            .iter()
            .filter_map(|p| p.split_once('='))
            .filter(|(name, _)| name == key)
            .map(|(_, value)| value)
            .collect();
        if values.len() != 1 || !safe_query_value(values[0]) {
            return Err(denied());
        }
        // Bundled mode owns only this folder. External development mode may inspect/scan its selected folder.
        if managed && *key == "folder" && values[0] != "s-light-notes" {
            return Err(denied());
        }
    }
    Ok(())
}

fn safe_query_value(value: &str) -> bool {
    if value.is_empty() || value.len() > 1024 {
        return false;
    }
    let mut bytes = value.bytes();
    while let Some(byte) = bytes.next() {
        if byte == b'%' {
            if !bytes.next().is_some_and(|b| b.is_ascii_hexdigit())
                || !bytes.next().is_some_and(|b| b.is_ascii_hexdigit())
            {
                return false;
            }
        } else if !byte.is_ascii_alphanumeric() && !b"-_.!~*'()".contains(&byte) {
            return false;
        }
    }
    true
}

fn pick(value: &Value, keys: &[&str]) -> Value {
    let mut result = serde_json::Map::new();
    for key in keys {
        if let Some(value) = value.get(key) {
            result.insert((*key).into(), value.clone());
        }
    }
    Value::Object(result)
}

pub(super) fn sanitize(path: &str, body: &str, managed: bool) -> Result<String, String> {
    let endpoint = path.split('?').next().unwrap_or("");
    if endpoint == "/rest/db/scan" {
        return Ok("{}".into());
    }
    let value: Value = serde_json::from_str(body).map_err(|_| "同步引擎响应格式无效。")?;
    let result = match endpoint {
        "/rest/system/status" => pick(&value, &["myID", "myId"]),
        "/rest/config/folders" => Value::Array(
            value
                .as_array()
                .ok_or("同步文件夹响应无效。")?
                .iter()
                .filter(|folder| !managed || folder["id"] == "s-light-notes")
                .map(|folder| {
                    let mut result = pick(
                        folder,
                        if managed {
                            &["id", "label"][..]
                        } else {
                            &["id", "label", "path"][..]
                        },
                    );
                    result["devices"] = Value::Array(
                        folder["devices"]
                            .as_array()
                            .into_iter()
                            .flatten()
                            .map(|device| pick(device, &["deviceID"]))
                            .collect(),
                    );
                    result
                })
                .collect(),
        ),
        "/rest/config/devices" => Value::Array(
            value
                .as_array()
                .ok_or("同步设备响应无效。")?
                .iter()
                .map(|device| pick(device, &["deviceID", "name"]))
                .collect(),
        ),
        "/rest/system/connections" => {
            let mut connections = serde_json::Map::new();
            if let Some(items) = value["connections"].as_object() {
                for (id, connection) in items {
                    connections.insert(id.clone(), pick(connection, &["connected"]));
                }
            }
            json!({"connections": connections})
        }
        "/rest/db/status" => pick(
            &value,
            &[
                "state",
                "needTotalItems",
                "globalFiles",
                "localFiles",
                "needFiles",
            ],
        ),
        "/rest/db/completion" => pick(&value, &["completion", "needItems"]),
        "/rest/config/restart-required" => pick(&value, &["requiresRestart"]),
        // The UI only needs these templates as a readiness signal. Native confirm reads fresh templates itself.
        "/rest/config/defaults/folder" | "/rest/config/defaults/device" => json!({}),
        _ => return Err("同步响应路径不受支持。".into()),
    };
    serde_json::to_string(&result).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_config_writes_credentials_and_query_bypasses() {
        for path in [
            "/rest/config",
            "/rest/config/gui",
            "/rest/config/folders",
            "/rest/config/devices",
            "/rest/system/shutdown",
        ] {
            assert!(validate("POST", path, None, true).is_err());
        }
        for path in [
            "/rest/config/gui",
            "/rest/config",
            "/rest/db/scan?folder=s-light-notes&folder=other",
            "/rest/db/scan?folder=s-light-notes&sub=secret",
            "/rest/db/scan?folder=other",
            "/rest/db/scan?folder=s-light-notes#ignored",
            "/rest/db/scan?folder=%",
            "/rest/db/scan?folder=s-light-notes&x",
        ] {
            assert!(validate("POST", path, None, true).is_err());
        }
        assert!(validate("GET", "/rest/config/gui", None, true).is_err());
        assert!(validate(
            "POST",
            "/rest/db/scan?folder=s-light-notes",
            Some("{}"),
            true
        )
        .is_err());
        assert!(validate("PUT", "/rest/config/folders", Some("{}"), false).is_err());
    }
    #[test]
    fn permits_required_queries_and_fixed_scan() {
        for path in [
            "/rest/system/status",
            "/rest/config/folders",
            "/rest/config/devices",
            "/rest/system/connections",
            "/rest/config/defaults/folder",
            "/rest/config/defaults/device",
            "/rest/config/restart-required",
            "/rest/db/status?folder=s-light-notes",
            "/rest/db/completion?folder=s-light-notes&device=AB-CD",
        ] {
            validate("GET", path, None, true).unwrap();
        }
        validate("POST", "/rest/db/scan?folder=s-light-notes", None, true).unwrap();
        validate(
            "GET",
            "/rest/db/status?folder=%E7%AC%94%E8%AE%B0",
            None,
            false,
        )
        .unwrap();
    }
    #[test]
    fn strips_private_and_nested_configuration_fields() {
        let folders = json!([{"id":"s-light-notes","label":"Notes","path":"private", "password":"secret",
            "devices":[{"deviceID":"ID","encryptionPassword":"secret"}]}, {"id":"other"}]);
        let sanitized = sanitize("/rest/config/folders", &folders.to_string(), true).unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&sanitized).unwrap(),
            json!([{"id":"s-light-notes","label":"Notes","devices":[{"deviceID":"ID"}]}])
        );
        assert_eq!(
            sanitize(
                "/rest/config/defaults/device",
                r#"{"apiKey":"secret"}"#,
                true
            )
            .unwrap(),
            "{}"
        );
        assert_eq!(
            sanitize(
                "/rest/system/connections",
                r#"{"connections":{"ID":{"connected":true,"address":"secret"}}}"#,
                true
            )
            .unwrap(),
            r#"{"connections":{"ID":{"connected":true}}}"#
        );
    }
}
