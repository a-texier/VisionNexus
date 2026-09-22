import os
import tempfile

os.environ.setdefault("TRAINING_APP_WORKSPACE", tempfile.mkdtemp(prefix="training_contract_test_"))
os.environ.setdefault("TRAINING_APP_USER", "pytest")
