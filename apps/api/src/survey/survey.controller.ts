import { Controller, Post, Body, Param } from '@nestjs/common';
import { SurveyService } from './survey.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('Mobile Survey Pipeline')
@Controller('surveys')
export class SurveyController {
  constructor(private readonly surveyService: SurveyService) {}

  @Post(':clusterId')
  @ApiOperation({ summary: 'Commit topographical array metrics globally via explicit PostGIS integrations' })
  async createSurvey(
    @Param('clusterId') clusterId: string,
    @Body() body: any
  ) {
     const surveyedBy = body.userId || `SYS_MOCK_USR`;
     return this.surveyService.createSurvey(clusterId, body, surveyedBy);
  }
}
