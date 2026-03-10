from webauthn import generate_registration_options
from webauthn.helpers.structs import AuthenticatorSelectionCriteria, ResidentKeyRequirement, UserVerificationRequirement

def test_options():
    options = generate_registration_options(
        rp_id="localhost",
        rp_name="Test",
        user_id="testuser",
        user_name="testuser",
        user_display_name="testuser"
    )
    print(f"User ID type: {type(options.user.id)}")
    print(f"User ID value: {options.user.id}")

if __name__ == "__main__":
    test_options()
