import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@permatrack/db';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProjectDto } from './dto/create-project.dto';

export type CreateProjectData = Prisma.ProjectCreateInput;

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createProjectDto: CreateProjectDto) {
    const data: CreateProjectData = {
      projectCode: createProjectDto.projectCode,
      namaProyek: createProjectDto.namaProyek,
      regionalArea: createProjectDto.regionalArea,
      lokasiProyek: createProjectDto.lokasiProyek,
      noPO: createProjectDto.noPO,
      namaPelaksana: createProjectDto.namaPelaksana,
      status: createProjectDto.status,
      tanggalPerjanjian: new Date(createProjectDto.tanggalPerjanjian)
    };
    return this.prisma.project.create({
      data,
    });
  }

  async findAll() {
    return this.prisma.project.findMany({
      orderBy: { createdAt: 'desc' }
    });
  }

  async findOne(id: string) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  async update(id: string, updateData: Partial<CreateProjectDto>) {
    const data: Partial<CreateProjectData> = {};
    if (updateData.tanggalPerjanjian) data.tanggalPerjanjian = new Date(updateData.tanggalPerjanjian);
    if (updateData.projectCode) data.projectCode = updateData.projectCode;
    if (updateData.namaProyek) data.namaProyek = updateData.namaProyek;
    if (updateData.regionalArea) data.regionalArea = updateData.regionalArea;
    if (updateData.lokasiProyek) data.lokasiProyek = updateData.lokasiProyek;
    if (updateData.noPO) data.noPO = updateData.noPO;
    if (updateData.namaPelaksana) data.namaPelaksana = updateData.namaPelaksana;
    if (updateData.status) data.status = updateData.status;

    return this.prisma.project.update({
      where: { id },
      data,
    });
  }

  async remove(id: string) {
    return this.prisma.project.delete({ where: { id } });
  }
}
