/**
 * Unit Tests: Application Deployment Tool
 * Tests the deploy application tool functionality with mock Kubernetes client
 * Following analyze-repo test structure and comprehensive coverage requirements
 */

import { jest } from '@jest/globals';
import { deployApplication as deployApplicationTool } from '../../../src/tools/deploy/tool';
import type { DeployApplicationParams } from '../../../src/tools/deploy/schema';
import type { ToolContext } from '@mcp/context/types';
import { createMockLogger, createSuccessResult, createFailureResult } from '../../__support__/utilities/mock-infrastructure';

// Mock lib modules following analyze-repo pattern
const mockSessionManager = {
  create: jest.fn().mockResolvedValue({
    "sessionId": "test-session-123",
    "workflow_state": {},
    "metadata": {},
    "completed_steps": [],
    "errors": {},
    "current_step": null,
    "createdAt": "2025-09-08T11:12:40.362Z",
    "updatedAt": "2025-09-08T11:12:40.362Z"
  }),
  get: jest.fn(),
  update: jest.fn(),
};

const mockKubernetesClient = {
  applyManifest: jest.fn(),
  getDeploymentStatus: jest.fn(),
};

const mockTimer = {
  end: jest.fn(),
  error: jest.fn(),
};

// Mock js-yaml for manifest parsing
jest.mock('js-yaml', () => ({
  loadAll: jest.fn((content: string) => {
    // Simple YAML parser mock for testing
    if (content.includes('kind: Deployment')) {
      const manifests = [
        {
          apiVersion: 'apps/v1',
          kind: 'Deployment',
          metadata: { name: 'test-app', namespace: 'default' },
          spec: { replicas: 2 },
        },
      ];

      // Check for LoadBalancer service
      if (content.includes('LoadBalancer')) {
        manifests.push({
          apiVersion: 'v1',
          kind: 'Service',
          metadata: { name: 'test-app', namespace: 'default' },
          spec: { ports: [{ port: 80 }], type: 'LoadBalancer' },
        });
      }
      // Check for Ingress
      else if (content.includes('kind: Ingress')) {
        manifests.push({
          apiVersion: 'v1',
          kind: 'Service',
          metadata: { name: 'test-app', namespace: 'default' },
          spec: { ports: [{ port: 80 }], type: 'ClusterIP' },
        });
        manifests.push({
          apiVersion: 'networking.k8s.io/v1',
          kind: 'Ingress',
          metadata: { name: 'test-app-ingress', namespace: 'default' },
          spec: { rules: [{ host: 'app.example.com' }] },
        });
      }
      // Default ClusterIP service
      else {
        manifests.push({
          apiVersion: 'v1',
          kind: 'Service',
          metadata: { name: 'test-app', namespace: 'default' },
          spec: { ports: [{ port: 80 }], type: 'ClusterIP' },
        });
      }

      return manifests;
    }
    return [];
  }),
}));

jest.mock('../../../src/lib/session', () => ({
  createSessionManager: jest.fn(() => mockSessionManager),
}));

// Mock MCP helper modules
jest.mock('@mcp/tools/session-helpers');

jest.mock('../../../src/lib/kubernetes', () => ({
  createKubernetesClient: jest.fn(() => mockKubernetesClient),
}));

jest.mock('../../../src/lib/logger', () => ({
  createTimer: jest.fn(() => mockTimer),
  createLogger: jest.fn(() => createMockLogger()),
}));

// Mock DEFAULT_TIMEOUTS
jest.mock('../../../src/config/defaults', () => ({
  DEFAULT_TIMEOUTS: {
    deploymentPoll: 1000, // Short timeout for tests
  },
}));

// Create mock ToolContext
function createMockToolContext(): ToolContext {
  return {
    logger: createMockLogger(),
    progressReporter: jest.fn(),
  };
}

describe('deployApplication', () => {
  let mockLogger: ReturnType<typeof createMockLogger>;
  let config: DeployApplicationParams;

  // Sample K8s manifests for testing
  const sampleManifests = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: test-app
  namespace: default
spec:
  replicas: 2
  selector:
    matchLabels:
      app: test-app
  template:
    metadata:
      labels:
        app: test-app
    spec:
      containers:
      - name: test-app
        image: test-app:v1.0
        ports:
        - containerPort: 3000
---
apiVersion: v1
kind: Service
metadata:
  name: test-app
  namespace: default
spec:
  selector:
    app: test-app
  ports:
  - port: 80
    targetPort: 3000
  type: ClusterIP
`;

  beforeEach(() => {
    mockLogger = createMockLogger();
    config = {
      sessionId: 'test-session-123',
      namespace: 'default',
      cluster: 'default',
      dryRun: false,
      wait: true,
      timeout: 30, // Short timeout for tests
    };

    // Reset all mocks
    jest.clearAllMocks();
    mockSessionManager.update.mockResolvedValue(true);
    mockKubernetesClient.applyManifest.mockResolvedValue(createSuccessResult({}));
    
    // Setup session helper mocks
    const sessionHelpers = require('@mcp/tools/session-helpers');
    sessionHelpers.getSession = jest.fn().mockResolvedValue({
      ok: true,
      value: {
        id: 'test-session-123',
        state: {
          sessionId: 'test-session-123',
          k8s_manifests: {
            manifests: sampleManifests,  // The tool expects the manifests as a string, not an array
          },
          metadata: {},
          completed_steps: [],
        },
        isNew: false,
      },
    });
    sessionHelpers.updateSession = jest.fn().mockResolvedValue({ ok: true });
  });

  describe('Successful Deployments', () => {
    beforeEach(() => {
      // Session with K8s manifests
      mockSessionManager.get.mockResolvedValue({
        
k8s_manifests: {
  manifests: sampleManifests,
},
        repo_path: '/test/repo',
      });

      // Default deployment status - ready
      mockKubernetesClient.getDeploymentStatus.mockResolvedValue(createSuccessResult({
        ready: true,
        readyReplicas: 2,
        totalReplicas: 2,
        conditions: [{ type: 'Available', status: 'True', message: 'Deployment is available' }]
      }));
    });

    it('should successfully deploy application with valid manifests', async () => {
      const mockContext = createMockToolContext();
      const result = await deployApplicationTool(config, mockContext);

      if (!result.ok) {
        console.error('Deploy failed with error:', result.error);
      }
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(true);
        expect(result.value.sessionId).toBe('test-session-123');
        expect(result.value.namespace).toBe('default');
        expect(result.value.deploymentName).toBe('test-app');
        expect(result.value.serviceName).toBe('test-app');
        expect(result.value.ready).toBe(true);
        expect(result.value.replicas).toBe(2);
        expect(result.value.endpoints).toEqual([
          {
            type: 'internal',
            url: 'http://test-app.default.svc.cluster.local',
            port: 80,
          },
        ]);
        expect(result.value.status?.readyReplicas).toBe(2);
        expect(result.value.status?.totalReplicas).toBe(2);
        expect(result.value.status?.conditions).toEqual([
          {
            type: 'Available',
            status: 'True',
            message: 'Deployment is available',
          },
        ]);
      }

      // Verify Kubernetes client was called to apply manifests
      expect(mockKubernetesClient.applyManifest).toHaveBeenCalledTimes(2);
      
      // Verify deployment status was checked
      expect(mockKubernetesClient.getDeploymentStatus).toHaveBeenCalledWith('default', 'test-app');
      
      // Verify session was updated using standardized helpers
      const sessionHelpers = require('@mcp/tools/session-helpers');
      expect(sessionHelpers.updateSession).toHaveBeenCalledWith(
        'test-session-123',
        expect.objectContaining({
          deployment_result: expect.objectContaining({
            namespace: 'default',
            deploymentName: 'test-app',
            serviceName: 'test-app',
            ready: true,
          }),
          completed_steps: expect.arrayContaining(['deploy']),
        }),
        
        expect.any(Object)  // context
      );
    });


    it('should use default values when config options not specified', async () => {
      const minimalConfig: DeployApplicationConfig = {
        sessionId: 'test-session-123',
      };

      const mockContext = createMockToolContext();
      const result = await deployApplicationTool(minimalConfig, mockContext);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.namespace).toBe('default'); // Default namespace
      }

      // Verify deployment was applied to default namespace
      expect(mockKubernetesClient.applyManifest).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'Deployment' }),
        'default'
      );
    });

    it('should handle custom namespace deployment', async () => {
      config.namespace = 'production';

      const mockContext = createMockToolContext();
      const result = await deployApplicationTool(config, mockContext);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.namespace).toBe('production');
        expect(result.value.endpoints[0].url).toBe('http://test-app.production.svc.cluster.local');
      }

      expect(mockKubernetesClient.applyManifest).toHaveBeenCalledWith(
        expect.anything(),
        'production'
      );
    });

  });

  describe('Manifest Parsing and Ordering', () => {
    beforeEach(() => {
      // Use the existing sampleManifests which are properly handled by the YAML mock
      mockSessionManager.get.mockResolvedValue({
        
k8s_manifests: {
  manifests: sampleManifests,
},
        repo_path: '/test/repo',
      });

      mockKubernetesClient.getDeploymentStatus.mockResolvedValue(createSuccessResult({
        ready: true,
        readyReplicas: 2,
      }));
    });

    it('should parse YAML manifests correctly', async () => {
      const mockContext = createMockToolContext();
      const result = await deployApplicationTool(config, mockContext);

      expect(result.ok).toBe(true);
      // Verify manifests were processed (Deployment and Service)
      expect(mockKubernetesClient.applyManifest).toHaveBeenCalledTimes(2);
    });

    it('should order manifests correctly for deployment', async () => {
      const mockContext = createMockToolContext();
      await deployApplicationTool(config, mockContext);

      // Verify manifests were applied - the actual ordering is based on the implementation's sort logic
      const calls = mockKubernetesClient.applyManifest.mock.calls;
      expect(calls.length).toBe(2);
      
      // The implementation orders: Service before Deployment based on the ordering array
      expect(calls[0][0]).toEqual(expect.objectContaining({ kind: 'Service' }));
      expect(calls[1][0]).toEqual(expect.objectContaining({ kind: 'Deployment' }));
    });
  });

  describe('Service and Ingress Endpoint Detection', () => {

  });

  describe('Error Handling', () => {



    it('should handle Kubernetes client failures gracefully', async () => {
      mockSessionManager.get.mockResolvedValue({
        
k8s_manifests: {
  manifests: sampleManifests,
},
        repo_path: '/test/repo',
      });

      mockKubernetesClient.applyManifest.mockResolvedValue(
        createFailureResult('Failed to connect to Kubernetes cluster')
      );

      const mockContext = createMockToolContext();
      const result = await deployApplicationTool(config, mockContext);

      expect(result.ok).toBe(true); // Function continues despite individual manifest failures
      // Individual manifest failures are logged but don't stop the deployment
    });




    it('should handle session update failures', async () => {
      // Mock updateSessionData to fail
      const sessionHelpers = require('@mcp/tools/session-helpers');
      sessionHelpers.updateSession.mockResolvedValueOnce({ ok: false, error: 'Failed to update session' });

      mockKubernetesClient.getDeploymentStatus.mockResolvedValue(createSuccessResult({
        ready: true,
        readyReplicas: 2,
      }));

      const mockContext = createMockToolContext();
      const result = await deployApplicationTool(config, mockContext);

      // The deployment should still succeed but log a warning about the session update failure
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(true);
      }
    });
  });

  describe('Configuration Options', () => {
    beforeEach(() => {
      mockSessionManager.get.mockResolvedValue({
        
k8s_manifests: {
  manifests: sampleManifests,
},
        repo_path: '/test/repo',
      });

      mockKubernetesClient.getDeploymentStatus.mockResolvedValue(createSuccessResult({
        ready: true,
        readyReplicas: 2,
      }));
    });

    it('should handle different cluster configurations', async () => {
      config.cluster = 'production-cluster';

      const mockContext = createMockToolContext();
      const result = await deployApplicationTool(config, mockContext);

      expect(result.ok).toBe(true);
      // Cluster configuration affects how the Kubernetes client is created
      // This verifies the function accepts the parameter correctly
    });

    it('should handle custom timeout values', async () => {
      config.timeout = 600; // 10 minutes

      const mockContext = createMockToolContext();
      const result = await deployApplicationTool(config, mockContext);

      expect(result.ok).toBe(true);
      // Custom timeout affects the deployment readiness wait logic
    });

    it('should handle boolean configuration options correctly', async () => {
      const testConfigs = [
        { dryRun: true, wait: false },
        { dryRun: false, wait: true },
        { dryRun: true, wait: true },
        { dryRun: false, wait: false },
      ];

      for (const testConfig of testConfigs) {
        const configWithOptions = { ...config, ...testConfig };
        const mockContext = createMockToolContext();
        const result = await deployApplicationTool(configWithOptions, mockContext);
        
        expect(result.ok).toBe(true);
        if (result.ok) {
          // Different combinations should all succeed
          expect(result.value.success).toBe(true);
        }

        // Reset mocks between tests
        jest.clearAllMocks();
        mockSessionManager.update.mockResolvedValue(true);
        mockKubernetesClient.applyManifest.mockResolvedValue(createSuccessResult({}));
        mockKubernetesClient.getDeploymentStatus.mockResolvedValue(createSuccessResult({
          ready: true,
          readyReplicas: 2,
        }));
      }
    });
  });
});