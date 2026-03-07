"""
Shared WebAuthn credential builder helpers.

Converts the frontend-serialized credential dicts (base64url strings for all
binary fields) into the typed structs expected by py_webauthn v1.x.

Keeping these here avoids circular imports between auth/routes.py and
trust/routes.py, both of which need to parse authenticator responses.
"""

import base64

from webauthn.helpers.structs import (
    RegistrationCredential,
    AuthenticationCredential,
    AuthenticatorAttestationResponse,
    AuthenticatorAssertionResponse,
)


def b64url_decode(s: str) -> bytes:
    """Decode a base64url string (with or without padding) to bytes."""
    if not s:
        return b""
    padding = 4 - len(s) % 4
    if padding < 4:
        s += "=" * padding
    return base64.urlsafe_b64decode(s)


def build_registration_credential(raw: dict) -> RegistrationCredential:
    """
    Convert a frontend-serialized WebAuthn registration dict into a
    ``RegistrationCredential`` for py_webauthn's ``verify_registration_response``.

    The frontend's ``serializeCredential`` helper encodes all binary fields as
    base64url strings.
    """
    response = raw.get("response", {})
    return RegistrationCredential(
        id=raw["id"],
        raw_id=b64url_decode(raw.get("rawId", raw["id"])),
        response=AuthenticatorAttestationResponse(
            client_data_json=b64url_decode(response["clientDataJSON"]),
            attestation_object=b64url_decode(response["attestationObject"]),
        ),
        type=raw.get("type", "public-key"),
    )


def build_authentication_credential(raw: dict) -> AuthenticationCredential:
    """
    Convert a frontend-serialized WebAuthn assertion dict into an
    ``AuthenticationCredential`` for py_webauthn's ``verify_authentication_response``.
    """
    response = raw.get("response", {})
    return AuthenticationCredential(
        id=raw["id"],
        raw_id=b64url_decode(raw.get("rawId", raw["id"])),
        response=AuthenticatorAssertionResponse(
            client_data_json=b64url_decode(response["clientDataJSON"]),
            authenticator_data=b64url_decode(response["authenticatorData"]),
            signature=b64url_decode(response["signature"]),
            user_handle=b64url_decode(response["userHandle"]) if response.get("userHandle") else None,
        ),
        type=raw.get("type", "public-key"),
    )
