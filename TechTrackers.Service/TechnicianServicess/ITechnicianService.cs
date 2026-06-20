using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using TechTrackers.Data.Model.dto;

namespace TechTrackers.Service.TechnicianServicess
{
    public interface ITechnicianService
    {
        // Task<RespondWrapper> GetTechnicianLogStatsAsync(int technicianId, string status);

        Task<int> GetTechnicianLogCountAsync(int technicianId, string status);

    }
}
