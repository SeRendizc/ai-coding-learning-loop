# Privacy

The default evidence policy stores queryable metadata, result codes, references, and SHA-256 digests. It does not intentionally retain source text, complete tool arguments, tool output, secrets, or free-text Gate answers.

Sensitive-looking keys are replaced by a redaction marker and digest before persistence. Tool-hook probes retain only call ID, tool name, scope presence, error status, and content-block count.

Evidence files are created with owner-only permissions where supported. Users remain responsible for selecting an evidence root with appropriate disk encryption, backup, retention, and access controls.

Deleting evidence is a user-controlled filesystem operation. The plugin does not currently implement remote telemetry or upload evidence.
