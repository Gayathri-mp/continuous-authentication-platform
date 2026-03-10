from webauthn import generate_registration_options
from webauthn.helpers.structs import AuthenticatorSelectionCriteria, ResidentKeyRequirement, UserVerificationRequirement
try:
    options = generate_registration_options(
        rp_id="localhost",
        rp_name="Test",
        user_id="testuser".encode("utf-8"),
        user_name="testuser",
        user_display_name="testuser"
    )
    print("Success with bytes!")
except Exception as e:
    print(f"Failed with bytes: {type(e).__name__}: {e}")

try:
    options = generate_registration_options(
        rp_id="localhost",
        rp_name="Test",
        user_id="testuser",
        user_name="testuser",
        user_display_name="testuser"
    )
    print("Success with string!")
except Exception as e:
    print(f"Failed with string: {type(e).__name__}: {e}")
