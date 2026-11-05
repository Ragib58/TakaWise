-- Runs once on first container start (empty volume).
-- Separate database for integration tests so they never touch development data.
CREATE DATABASE takawise_test;
