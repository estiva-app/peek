//! Phase 4 interop harness.
//!
//! Reads the JSON that Peek's emitter produced and runs BUZZ'S OWN CODE over
//! it — buzz_core::verify_event, buzz_core::kind::ALL_KINDS, buzz_sdk's
//! extract_channel_id, and buzz_core::filter::filters_match. Then rebuilds the
//! same message with buzz_sdk::builders::build_message and diffs the tags.
//!
//! Nothing here reimplements a Buzz rule; every check calls into the Buzz
//! crates as a dependency.

use std::io::Read;

use buzz_core::kind::ALL_KINDS;
use buzz_core::{verify_event, StoredEvent};
use nostr::{Event, JsonUtil};

fn check(label: &str, ok: bool, detail: String) -> bool {
    println!(
        "  [{}] {label}{}",
        if ok { "PASS" } else { "FAIL" },
        if detail.is_empty() {
            String::new()
        } else {
            format!("\n         {detail}")
        }
    );
    ok
}

fn tags_of(e: &Event) -> Vec<Vec<String>> {
    e.tags
        .iter()
        .map(|t| t.as_slice().to_vec())
        .collect::<Vec<_>>()
}

fn main() {
    let mut raw = String::new();
    std::io::stdin().read_to_string(&mut raw).expect("read stdin");
    let doc: serde_json::Value = serde_json::from_str(&raw).expect("parse emitter output");

    let mut all_ok = true;

    for name in ["channel_event", "message_event"] {
        let ev_json = doc[name].to_string();
        println!("\n=== {name} ===");

        // 1. Parse with the same nostr crate version buzz-core uses.
        let event = match Event::from_json(&ev_json) {
            Ok(e) => e,
            Err(e) => {
                all_ok &= check("parses as a nostr Event", false, format!("{e}"));
                continue;
            }
        };
        all_ok &= check("parses as a nostr Event", true, String::new());

        // 2. Buzz's real id-hash + Schnorr verification.
        let verified = verify_event(&event);
        all_ok &= check(
            "buzz_core::verify_event (NIP-01 id hash + BIP-340 sig)",
            verified.is_ok(),
            match &verified {
                Ok(()) => format!("id={}", event.id.to_hex()),
                Err(e) => format!("{e}"),
            },
        );

        // 3. Kind is in Buzz's authoritative registry.
        let kind_u32 = buzz_core::kind::event_kind_u32(&event);
        all_ok &= check(
            "kind is registered in buzz_core::kind::ALL_KINDS",
            ALL_KINDS.contains(&kind_u32),
            format!("kind={kind_u32}"),
        );

        // 4. Buzz's own h-tag → channel UUID extraction.
        let channel = buzz_sdk::builders::extract_channel_id(&event);
        all_ok &= check(
            "buzz_sdk::builders::extract_channel_id finds a valid channel UUID",
            channel.is_some(),
            match channel {
                Some(u) => format!("channel_id={u}"),
                None => "no usable `h` tag".into(),
            },
        );

        // 5. Would a normal Buzz client REQ match it?
        if let Some(ch) = channel {
            let stored = StoredEvent::new(event.clone(), Some(ch));
            let filter = nostr::Filter::new()
                .kind(event.kind)
                .custom_tag(nostr::SingleLetterTag::lowercase(nostr::Alphabet::H), ch.to_string());
            all_ok &= check(
                "buzz_core::filter::filters_match against {kinds,#h} REQ",
                buzz_core::filter::filters_match(&[filter], &stored),
                format!("REQ {{\"kinds\":[{kind_u32}],\"#h\":[\"{ch}\"]}}"),
            );
        }

        // 6. Structural diff against the canonical builder.
        if kind_u32 == 9 {
            let ch = channel.expect("channel checked above");
            let canonical = buzz_sdk::builders::build_message(ch, &event.content, None, &[], false, &[])
                .expect("build_message")
                .custom_created_at(event.created_at)
                .build(event.pubkey);
            let want = canonical
                .tags
                .iter()
                .map(|t| t.as_slice().to_vec())
                .collect::<Vec<_>>();
            let got = tags_of(&event);
            all_ok &= check(
                "tags match buzz_sdk::builders::build_message output",
                want == got,
                format!("want={want:?}\n         got ={got:?}"),
            );
            println!("         canonical id for same fields: {}", canonical.id.expect("unsigned event has id").to_hex());
            println!("         peek-emitted id             : {}", event.id.to_hex());
            println!(
                "         ids identical: {}",
                canonical.id.expect("unsigned event has id").to_hex() == event.id.to_hex()
            );
        }

        if kind_u32 == 9007 {
            let ch = channel.expect("channel checked above");
            let name_tag = event
                .tags
                .iter()
                .find(|t| t.as_slice().first().map(String::as_str) == Some("name"))
                .and_then(|t| t.as_slice().get(1).cloned())
                .unwrap_or_default();
            let canonical = buzz_sdk::builders::build_create_channel(
                ch,
                &name_tag,
                Some(buzz_sdk::Visibility::Open),
                Some(buzz_sdk::ChannelKind::Stream),
                None,
                None,
            )
            .expect("build_create_channel")
            .build(event.pubkey);
            let want = canonical
                .tags
                .iter()
                .map(|t| t.as_slice().to_vec())
                .collect::<Vec<_>>();
            let got = tags_of(&event);
            all_ok &= check(
                "tags match buzz_sdk::builders::build_create_channel output",
                want == got,
                format!("want={want:?}\n         got ={got:?}"),
            );
        }
    }

    println!("\n=== RESULT: {} ===", if all_ok { "PASS" } else { "FAIL" });
    if !all_ok {
        std::process::exit(1);
    }
}
