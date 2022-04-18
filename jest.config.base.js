// @formatter:off
module.exports = {
    roots: [
        '<rootDir>/src',
    ],
    testEnvironment: 'jsdom',
    collectCoverage: true,
    collectCoverageFrom: [
        '<rootDir>/**/*.ts',
        '!**/node_modules/**',
        '!**/__tests__/**',
        '!**/__integrationtests__/**',
    ],
    coverageDirectory: '.build-tmp/coverage',
    cacheDirectory: '.build-tmp/jest-cache',
    transform: {
        '^.+\\.tsx?$': 'ts-jest',
    },
    testRegex: '(/__tests__/.*|(\\.|/)(test|spec))\\.tsx?$',
    testPathIgnorePatterns: [
        '([A-Z]:)?((\w|[-_])*(\\|\/))*integration\.test\.ts$',
    ],
    moduleFileExtensions: [
        'ts',
        'tsx',
        'js',
        'jsx',
        'json',
        'node',
    ],
    reporters: [
        "default",
        ["jest-junit", {
            outputDirectory: ".build-tmp",
            outputName: "junit.xml",
        }],
    ],
};