import swaggerJsdoc from 'swagger-jsdoc';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Insighta Labs+ API',
      version: '3.0.0',
      description: `
        Insighta Labs+ Profile Intelligence System API
        This API provides secure access to profile data with role-based authentication.
        
        ## Features
        - GitHub OAuth 2.0 with PKCE
        - Role-based access control (Admin & Analyst)
        - Profile management with advanced filtering
        - Natural language search
        - Multi-interface support (CLI & Web)
      `,
      contact: {
        name: 'Insighta Labs',
        email: 'support@insighta.com',
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT',
      },
    },
    servers: [
      {
        url: 'http://localhost:3000/api',
        description: 'Development server',
      },
      {
        url: 'https://api.insighta.com/api',
        description: 'Production server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter your JWT token',
        },
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'access_token',
          description: 'Session cookie for web clients',
        },
      },
      schemas: {
        ErrorResponse: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              example: 'error',
            },
            message: {
              type: 'string',
              example: 'Error message description',
            },
            error_code: {
              type: 'string',
              example: 'INVALID_TOKEN',
            },
          },
        },
        Profile: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
              example: '123e4567-e89b-12d3-a456-426614174000',
            },
            name: {
              type: 'string',
              example: 'John Doe',
            },
            gender: {
              type: 'string',
              enum: ['male', 'female'],
              example: 'male',
            },
            gender_probability: {
              type: 'number',
              format: 'float',
              example: 0.95,
            },
            age: {
              type: 'integer',
              example: 25,
            },
            age_group: {
              type: 'string',
              enum: ['child', 'teenager', 'adult', 'senior'],
              example: 'adult',
            },
            country_id: {
              type: 'string',
              example: 'NG',
            },
            country_name: {
              type: 'string',
              example: 'Nigeria',
            },
            country_probability: {
              type: 'number',
              format: 'float',
              example: 0.98,
            },
            created_at: {
              type: 'string',
              format: 'date-time',
              example: '2024-01-01T00:00:00.000Z',
            },
          },
        },
        User: {
          type: 'object',
          properties: {
            id: {
              type: 'integer',
              example: 1,
            },
            username: {
              type: 'string',
              example: 'john_doe',
            },
            email: {
              type: 'string',
              example: 'john@example.com',
            },
            avatar_url: {
              type: 'string',
              example: 'https://avatars.githubusercontent.com/u/123',
            },
            role: {
              type: 'string',
              enum: ['admin', 'analyst'],
              example: 'analyst',
            },
            created_at: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
        PaginationResponse: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              example: 'success',
            },
            page: {
              type: 'integer',
              example: 1,
            },
            limit: {
              type: 'integer',
              example: 10,
            },
            total: {
              type: 'integer',
              example: 100,
            },
            data: {
              type: 'array',
              items: {
                $ref: '#/components/schemas/Profile',
              },
            },
          },
        },
      },
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
    tags: [
      {
        name: 'Authentication',
        description: 'Authentication endpoints - GitHub OAuth login, token refresh, logout',
      },
      {
        name: 'Profiles',
        description: 'Profile management endpoints - CRUD operations, search, export',
      },
      {
        name: 'Health',
        description: 'Health check endpoints',
      },
    ],
  },
  apis: ['./src/controllers/*.ts', './src/routes/*.ts'], // Path to the API docs
};

export const swaggerSpec = swaggerJsdoc(options);