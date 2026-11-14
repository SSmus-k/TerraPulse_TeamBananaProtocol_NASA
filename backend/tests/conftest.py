import pytest

from terrapulse.data.synthetic import SyntheticConfig, generate_synthetic_dataset


@pytest.fixture(scope="session")
def small_cfg():
    return SyntheticConfig(n_events=6, samples_per_event=(150, 220), n_test_events=2, seed=7)


@pytest.fixture(scope="session")
def small_df(small_cfg):
    return generate_synthetic_dataset(small_cfg)


@pytest.fixture()
def small_csv(tmp_path, small_df):
    p = tmp_path / "small.csv"
    small_df.to_csv(p, index=False)
    return p
